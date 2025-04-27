import mongoose from "mongoose";
import LPPosition from "../../models/LPPositionSchema.js";
import Order from "../../models/OrderSchema.js";
import { createAppError } from "../../utils/errorHandler.js";
export const createTrade = async (adminId, userId, tradeData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const newOrder = new Order({
      ...tradeData,
      user: userId,
      adminId: adminId,
      orderStatus: "PROCESSING",
    });

    const savedOrder = await newOrder.save({ session });

    const lpPosition = new LPPosition({
      positionId: tradeData.orderNo,
      type: tradeData.type,
      volume: tradeData.volume,
      symbol: tradeData.symbol,
      entryPrice: tradeData.price,
      openDate: tradeData.openingDate,
      currentPrice: tradeData.price,
      clientOrders: savedOrder._id,
    });

    const savedLPPosition = await lpPosition.save({ session });
    await session.commitTransaction();
    return { clientOrder: savedOrder};
  } catch (error) {
    // Abort transaction in case of error
    await session.abortTransaction();
    throw new Error(`Error creating trade: ${error.message}`);
  } finally {
    // End the session
    session.endSession();
  }
};

export const getTradesByUser = async (adminId, userId) => {
  try {
    const trades = await Order.find({
      adminId: adminId,
    })
      .populate(
        "user",
        "firstName lastName ACCOUNT_HEAD email phoneNumber accountStatus"
      )
      .sort({ createdAt: -1 });

    return trades;
  } catch (error) {
    throw createAppError(`Error fetching trades: ${error.message}`, 500);
  }
};

export const getTradeById = async (adminId, tradeId) => {
  try {
    const trade = await Order.findOne({
      _id: tradeId,
      adminId: adminId,
    });

    return trade;
  } catch (error) {
    throw createAppError(`Error fetching trade: ${error.message}`, 500);
  }
};

export const updateTradeStatus = async (adminId, orderId, updateData) => {
    const session = await mongoose.startSession();
    session.startTransaction();
  
    try {
      // Sanitize the update data to prevent modifying restricted fields
      const allowedUpdates = [
        "orderStatus",
        "closingPrice",
        "closingDate",
        "profit",
        "comment",
        "price",
      ];
  
      const sanitizedData = {};
      Object.keys(updateData).forEach((key) => {
        if (allowedUpdates.includes(key)) {
          sanitizedData[key] = updateData[key];
        }
      });
  
      // If we're closing the trade, set the closing date
      if (updateData.orderStatus === "CLOSED" && !sanitizedData.closingDate) {
        sanitizedData.closingDate = new Date();
      }
      if (sanitizedData.closingPrice) {
        sanitizedData.price = sanitizedData.closingPrice;
      }
  
      // Find the order first to get the orderNo
      const order = await Order.findOne({ _id: orderId, adminId: adminId }).session(session);
      
      if (!order) {
        throw new Error("Order not found or unauthorized");
      }
  
      // Update the order
      Object.keys(sanitizedData).forEach(key => {
        order[key] = sanitizedData[key];
      });
  
      await order.save({ session });
  
      // Now find and update the corresponding LP position
      const lpPosition = await LPPosition.findOne({ positionId: order.orderNo }).session(session);
      
      if (lpPosition) {
        // Update LP position based on order changes
        if (sanitizedData.closingPrice) {
          lpPosition.closingPrice = sanitizedData.closingPrice;
          lpPosition.currentPrice = sanitizedData.closingPrice;
        }
        
        if (sanitizedData.closingDate) {
          lpPosition.closeDate = sanitizedData.closingDate;
        }
        
        if (sanitizedData.orderStatus === "CLOSED") {
          lpPosition.status = "CLOSED";
          
          // Set LP profit directly from the provided value
          if (sanitizedData.profit !== undefined) {
            lpPosition.profit = sanitizedData.profit;
          }
        } else if (sanitizedData.price) {
          // Just updating the current price
          lpPosition.currentPrice = sanitizedData.price;
        }
        
        await lpPosition.save({ session });
      }
  
      await session.commitTransaction();
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw new Error(`Error updating trade: ${error.message}`);
    } finally {
      session.endSession();
    }
  };
