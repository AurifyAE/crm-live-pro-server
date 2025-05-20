import mongoose from "mongoose";
import LPPosition from "../../models/LPPositionSchema.js";
import Order from "../../models/OrderSchema.js";
import Ledger from "../../models/LedgerSchema.js";
import Account from "../../models/AccountSchema.js";
import { createAppError } from "../../utils/errorHandler.js";

const generateEntryId = (prefix) => {
  const timestamp = Date.now().toString();
  const randomStr = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${timestamp.substring(timestamp.length - 5)}-${randomStr}`;
};

const TROY_OUNCE_GRAMS = 31.103;
const GOLD_CONVERSION_FACTOR = 3.674;
const TTB_FACTOR = 116.64;

export const createTrade = async (adminId, userId, tradeData) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userAccount = await Account.findById(userId).session(session);
    if (!userAccount) {
      throw new Error("User account not found");
    }
    const currentCashBalance = userAccount.AMOUNTFC;
    const currentMetalBalance = userAccount.METAL_WT;
    const currentPrice = parseFloat(tradeData.price);
    const volume = parseFloat(tradeData.volume);
    
    // Use askSpread or bidSpread from user account based on order type
    let clientOrderPrice;
    if (tradeData.type === "BUY") {
      // For BUY orders, add askSpread to the current price
      clientOrderPrice = currentPrice + userAccount.askSpread;
    } else {
      // For SELL orders, subtract bidSpread from the current price
      clientOrderPrice = currentPrice - userAccount.bidSpread;
    }

    // Apply the TTB conversion factor for both client and LP prices
    const goldWeightValue =
      (clientOrderPrice / TROY_OUNCE_GRAMS) *
      GOLD_CONVERSION_FACTOR *
      TTB_FACTOR *
      volume;

    const lpCurrentPrice =
      (currentPrice / TROY_OUNCE_GRAMS) *
      GOLD_CONVERSION_FACTOR *
      TTB_FACTOR *
      volume;

    const newOrder = new Order({
      ...tradeData,
      profit: 0,
      user: userId,
      adminId: adminId,
      orderStatus: "PROCESSING",
      openingPrice: clientOrderPrice.toFixed(2),
    });
    const savedOrder = await newOrder.save({ session });

    const lpPosition = new LPPosition({
      positionId: tradeData.orderNo,
      type: tradeData.type,
      profit: tradeData.profit,
      volume: tradeData.volume,
      adminId: adminId,
      symbol: tradeData.symbol,
      entryPrice: currentPrice,
      openDate: tradeData.openingDate,
      currentPrice: currentPrice,
      clientOrders: savedOrder._id,
      status: "OPEN",
    });
    const savedLPPosition = await lpPosition.save({ session });

    // Use tradeData.requiredMargin instead of goldWeightValue to update the user's cash balance
    const requiredMargin = parseFloat(tradeData.requiredMargin || 0);
    const newCashBalance = currentCashBalance - requiredMargin;

    // Update metal balance based on order type
    let newMetalBalance = currentMetalBalance;
    if (tradeData.type === "BUY") {
      newMetalBalance = currentMetalBalance + tradeData.volume;
    } else if (tradeData.type === "SELL") {
      // For SELL orders, subtract from metal balance
      // Note: Commented out balance check
      // if (currentMetalBalance < tradeData.volume) {
      //   throw new Error("Insufficient gold balance for SELL order");
      // }
      newMetalBalance = currentMetalBalance - tradeData.volume;
    }

    // Update the account
    await Account.findByIdAndUpdate(
      userId,
      {
        AMOUNTFC: newCashBalance.toFixed(2),
        METAL_WT: newMetalBalance.toFixed(2),
      },
      { session, new: true }
    );

    // Create ledger entries

    // ORDER ledger entry (margin deduction)
    const orderLedgerEntry = new Ledger({
      entryId: generateEntryId("ORD"),
      entryType: "ORDER",
      referenceNumber: tradeData.orderNo,
      description: `Margin for ${tradeData.type} ${tradeData.volume} ${
        tradeData.symbol
      } @ ${clientOrderPrice} (AED ${(
        (clientOrderPrice / TROY_OUNCE_GRAMS) *
        GOLD_CONVERSION_FACTOR *
        TTB_FACTOR
      ).toFixed(2)})`,
      amount: requiredMargin.toFixed(2),
      entryNature: "DEBIT", // Debit because margin is being taken from the account
      runningBalance: newCashBalance.toFixed(2),
      orderDetails: {
        type: tradeData.type,
        symbol: tradeData.symbol,
        volume: tradeData.volume,
        entryPrice: clientOrderPrice,
        profit: 0,
        status: "PROCESSING",
      },
      user: userId,
      adminId: adminId,
      date: new Date(tradeData.openingDate),
    });
    await orderLedgerEntry.save({ session });

    // LP POSITION ledger entry
    const lpLedgerEntry = new Ledger({
      entryId: generateEntryId("LP"),
      entryType: "LP_POSITION",
      referenceNumber: tradeData.orderNo,
      description: `LP Position opened for ${tradeData.type} ${
        tradeData.volume
      } ${tradeData.symbol} @ ${currentPrice} (AED ${(
        (currentPrice / TROY_OUNCE_GRAMS) *
        GOLD_CONVERSION_FACTOR *
        TTB_FACTOR
      ).toFixed(2)})`,
      amount: lpCurrentPrice.toFixed(2),
      entryNature: "CREDIT", // Credit to the LP's perspective
      runningBalance: newCashBalance.toFixed(2),
      lpDetails: {
        positionId: tradeData.orderNo,
        type: tradeData.type,
        symbol: tradeData.symbol,
        volume: tradeData.volume,
        entryPrice: currentPrice,
        profit: 0,
        status: "OPEN",
      },
      user: userId,
      adminId: adminId,
      date: new Date(tradeData.openingDate),
    });
    await lpLedgerEntry.save({ session });

    // TRANSACTION ledger entry for cash (for accounting purposes)
    const cashTransactionLedgerEntry = new Ledger({
      entryId: generateEntryId("TRX"),
      entryType: "TRANSACTION",
      referenceNumber: tradeData.orderNo,
      description: `Margin allocation for trade ${tradeData.orderNo}`,
      amount: requiredMargin.toFixed(2),
      entryNature: "DEBIT", // Debit from user cash account
      runningBalance: newCashBalance.toFixed(2),
      transactionDetails: {
        type: null, // Not a deposit or withdrawal
        asset: "CASH",
        previousBalance: currentCashBalance,
      },
      user: userId,
      adminId: adminId,
      date: new Date(tradeData.openingDate),
      notes: `Cash margin allocated for ${tradeData.type} order on ${tradeData.symbol}`,
    });
    await cashTransactionLedgerEntry.save({ session });

    // TRANSACTION ledger entry for gold
    const goldTransactionLedgerEntry = new Ledger({
      entryId: generateEntryId("TRX"),
      entryType: "TRANSACTION",
      referenceNumber: tradeData.orderNo,
      description: `Gold ${
        tradeData.type === "BUY" ? "credit" : "debit"
      } for trade ${tradeData.orderNo}`,
      amount: tradeData.volume,
      entryNature: tradeData.type === "BUY" ? "CREDIT" : "DEBIT", // CREDIT for BUY, DEBIT for SELL
      runningBalance: newMetalBalance.toFixed(2),
      transactionDetails: {
        type: null, // Not a deposit or withdrawal
        asset: "GOLD",
        previousBalance: currentMetalBalance,
      },
      user: userId,
      adminId: adminId,
      date: new Date(tradeData.openingDate),
      notes: `Gold weight (${tradeData.volume}) ${
        tradeData.type === "BUY" ? "added to" : "subtracted from"
      } account for ${
        tradeData.type
      } order (Value: AED ${requiredMargin.toFixed(2)})`,
    });
    await goldTransactionLedgerEntry.save({ session });

    // Commit the transaction
    await session.commitTransaction();

    // Return relevant data
    return {
      clientOrder: savedOrder,
      lpPosition: savedLPPosition,
      balances: {
        cash: newCashBalance,
        gold: newMetalBalance,
      },
      requiredMargin,
      goldWeightValue,
      convertedPrice: {
        client: (
          (clientOrderPrice / TROY_OUNCE_GRAMS) *
          GOLD_CONVERSION_FACTOR *
          TTB_FACTOR
        ).toFixed(2),
        lp: (
          (currentPrice / TROY_OUNCE_GRAMS) *
          GOLD_CONVERSION_FACTOR *
          TTB_FACTOR
        ).toFixed(2),
      },
      ledgerEntries: {
        order: orderLedgerEntry,
        lp: lpLedgerEntry,
        cashTransaction: cashTransactionLedgerEntry,
        goldTransaction: goldTransactionLedgerEntry,
      },
    };
  } catch (error) {
    // Abort transaction in case of error
    await session.abortTransaction();
    console.error("Trade creation error:", error);
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
        "firstName lastName ACCOUNT_HEAD email phoneNumber userSpread accountStatus"
      )
      .sort({ createdAt: -1 });

    return trades;
  } catch (error) {
    throw createAppError(`Error fetching trades: ${error.message}`, 500);
  }
};
export const getOrdersByUser = async (adminId, userId) => {
  try {
    const orders = await Order.find({
      adminId: adminId,
      user: userId,
    })
      .populate(
        "user",
        "firstName lastName ACCOUNT_HEAD email phoneNumber userSpread accountStatus"
      )
      .sort({ createdAt: -1 });

    return orders;
  } catch (error) {
    throw createAppError(`Error fetching user orders: ${error.message}`, 500);
  }
};
export const getTradesByLP = async (adminId, userId) => {
  try {
    const trades = await LPPosition.find({
      adminId: adminId,
    }).sort({ createdAt: -1 });

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
  
  let committed = false; // Flag to track if transaction was committed

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

    // Find the order first to get all required details
    const order = await Order.findOne({
      _id: orderId,
      adminId: adminId,
    }).session(session);

    if (!order) {
      throw new Error("Order not found or unauthorized");
    }

    // Find the user account to get and update balances
    const userAccount = await Account.findById(order.user).session(session);
    if (!userAccount) {
      throw new Error("User account not found");
    }

    const currentPrice = parseFloat(sanitizedData.closingPrice || order.price);

    // Calculate client order closing price with appropriate spread adjustment
    let clientClosingPrice;
    if (order.type === "BUY") {
      // For BUY orders that are closing, we subtract the bidSpread (selling back)
      clientClosingPrice = currentPrice - userAccount.bidSpread;
    } else {
      // For SELL orders that are closing, we add the askSpread (buying back)
      clientClosingPrice = currentPrice + userAccount.askSpread;
    }

    // If we're closing the order, adjust the closing price for client
    if (sanitizedData.orderStatus === "CLOSED") {
      sanitizedData.closingPrice = clientClosingPrice.toString();
    }

    // Calculate gold weight values for entry and closing prices
    const entryPrice = parseFloat(order.openingPrice);
    const volume = parseFloat(order.volume);

    // Calculate original gold weight value (at entry)
    const entryGoldWeightValue =
      (entryPrice / TROY_OUNCE_GRAMS) *
      GOLD_CONVERSION_FACTOR *
      TTB_FACTOR *
      volume;

    // Calculate closing gold weight value
    const closingGoldWeightValue =
      (currentPrice / TROY_OUNCE_GRAMS) *
      GOLD_CONVERSION_FACTOR *
      TTB_FACTOR *
      volume;

    // Calculate profit in gold weight value
    let profitValue;
    if (order.type === "BUY") {
      profitValue = closingGoldWeightValue - entryGoldWeightValue;
    } else {
      // SELL
      profitValue = entryGoldWeightValue - closingGoldWeightValue;
    }
    
    let clientProfit;
    if (order.type === "BUY") {
      clientProfit = (clientClosingPrice - entryPrice) * volume;
    } else {
      // SELL
      clientProfit = (entryPrice - clientClosingPrice) * volume;
    }
    
    // Initialize the newCashBalance and newMetalBalance variables
    let newCashBalance = userAccount.AMOUNTFC;
    let newMetalBalance = userAccount.METAL_WT;
    
    // Update current balances
    const currentCashBalance = userAccount.AMOUNTFC;
    const currentMetalBalance = userAccount.METAL_WT;

    // Let's update the order with our sanitized data
    Object.keys(sanitizedData).forEach((key) => {
      order[key] = sanitizedData[key];
    });

    // If closing, set proper profit value
    if (sanitizedData.orderStatus === "CLOSED") {
      order.profit = profitValue.toFixed(2);
    }

    await order.save({ session });

    // Now find and update the corresponding LP position
    const lpPosition = await LPPosition.findOne({
      positionId: order.orderNo,
    }).session(session);

    if (lpPosition) {
      // Update LP position based on order changes but using price without spread
      if (sanitizedData.closingPrice) {
        lpPosition.closingPrice = currentPrice; // original price without spread
        lpPosition.currentPrice = currentPrice; // original price without spread
      }

      if (sanitizedData.closingDate) {
        lpPosition.closeDate = sanitizedData.closingDate;
      }

      if (sanitizedData.orderStatus === "CLOSED") {
        lpPosition.status = "CLOSED";
        
        // UPDATED LP PROFIT CALCULATION
        // Get the LP entry price 
        const lpEntryPrice = parseFloat(lpPosition.entryPrice);
        
        // Calculate order opening gold weight value
        const orderOpeningGoldWeightValue = 
          (entryPrice / TROY_OUNCE_GRAMS) * 
          GOLD_CONVERSION_FACTOR * 
          TTB_FACTOR * 
          volume;
          
        // Calculate LP entry gold weight value
        const lpEntryGoldWeightValue = 
          (lpEntryPrice / TROY_OUNCE_GRAMS) * 
          GOLD_CONVERSION_FACTOR * 
          TTB_FACTOR * 
          volume;
        
        // Calculate order closing gold weight value using client closing price
        const orderClosingGoldWeightValue = 
          (clientClosingPrice / TROY_OUNCE_GRAMS) * 
          GOLD_CONVERSION_FACTOR * 
          TTB_FACTOR * 
          volume;
          
        // Calculate LP closing gold weight value
        const lpClosingGoldWeightValue = 
          (currentPrice / TROY_OUNCE_GRAMS) * 
          GOLD_CONVERSION_FACTOR * 
          TTB_FACTOR * 
          volume;
        
        // Calculate the differences at opening and closing
        const openingDifference = Math.abs(lpEntryGoldWeightValue - orderOpeningGoldWeightValue);
        const closingDifference = Math.abs(lpClosingGoldWeightValue - orderClosingGoldWeightValue);
        
        // Calculate LP profit as the sum of these differences
        const lpProfit = openingDifference + closingDifference;
        
        lpPosition.profit = lpProfit.toFixed(2);
      } else if (sanitizedData.price) {
        // Just updating the current price
        lpPosition.currentPrice = currentPrice; // without spread
      }

      await lpPosition.save({ session });

      // If we're closing the trade, update balances and create ledger entries
      if (sanitizedData.orderStatus === "CLOSED") {
        // Update balances based on trade type
        newCashBalance = currentCashBalance;
        newMetalBalance = currentMetalBalance;

        // If order has requiredMargin, use that for settlement, otherwise calculate
        const settlementAmount = order.requiredMargin ? 
          parseFloat(order.requiredMargin) : 
          (order.type === "BUY" ? closingGoldWeightValue : entryGoldWeightValue);
          
        // Calculate profit to add to user's balance
        const userProfit = clientProfit > 0 ? clientProfit : 0;
        
        if (order.type === "BUY") {
          // For BUY orders that are closing, add settlement + profit to cash balance and deduct gold
          newCashBalance = currentCashBalance + settlementAmount + userProfit;
          newMetalBalance = currentMetalBalance - volume;
        } else if (order.type === "SELL") {
          // For SELL orders that are closing, add settlement + profit to cash balance and add gold back
          newCashBalance = currentCashBalance + settlementAmount + userProfit;
          newMetalBalance = currentMetalBalance + volume;
        }

        // Update the account
        await Account.findByIdAndUpdate(
          order.user,
          {
            AMOUNTFC: newCashBalance,
            METAL_WT: newMetalBalance,
          },
          { session, new: true }
        );

        // Generate entry ID helper function
        const generateEntryId = (prefix) => {
          const timestamp = Date.now().toString();
          const randomStr = Math.random()
            .toString(36)
            .substring(2, 5)
            .toUpperCase();
          return `${prefix}-${timestamp.substring(
            timestamp.length - 5
          )}-${randomStr}`;
        };

        // Create ORDER ledger entry (settlement credit and profit if applicable)
        const orderLedgerEntry = new Ledger({
          entryId: generateEntryId("ORD"),
          entryType: "ORDER",
          referenceNumber: order.orderNo,
          description: `Closing ${order.type} ${volume} ${order.symbol} @ ${clientClosingPrice}${userProfit > 0 ? ' with profit' : ''}`,
          amount: (settlementAmount + (userProfit > 0 ? userProfit : 0)).toFixed(2),
          entryNature: "CREDIT", // Credit because money is returned to account
          runningBalance: newCashBalance.toFixed(2),
          orderDetails: {
            type: order.type,
            symbol: order.symbol,
            volume: volume,
            entryPrice: entryPrice,
            closingPrice: clientClosingPrice.toFixed(2),
            profit: profitValue.toFixed(2),
            status: "CLOSED",
          },
          user: order.user,
          adminId: adminId,
          date: new Date(sanitizedData.closingDate),
        });
        await orderLedgerEntry.save({ session });

        // LP POSITION ledger entry
        const lpLedgerEntry = new Ledger({
          entryId: generateEntryId("LP"),
          entryType: "LP_POSITION",
          referenceNumber: order.orderNo,
          description: `LP Position closed for ${order.type} ${volume} ${order.symbol} @ ${currentPrice}`,
          amount: settlementAmount.toFixed(2),
          entryNature: "DEBIT", // Debit from LP's perspective
          runningBalance: newCashBalance.toFixed(2),
          lpDetails: {
            positionId: order.orderNo,
            type: order.type,
            symbol: order.symbol,
            volume: volume,
            entryPrice: parseFloat(lpPosition.entryPrice),
            closingPrice: currentPrice,
            profit: lpPosition.profit,
            status: "CLOSED",
          },
          user: order.user,
          adminId: adminId,
          date: new Date(sanitizedData.closingDate),
        });
        await lpLedgerEntry.save({ session });

        // TRANSACTION ledger entry for cash (for accounting purposes)
        const cashTransactionLedgerEntry = new Ledger({
          entryId: generateEntryId("TRX"),
          entryType: "TRANSACTION",
          referenceNumber: order.orderNo,
          description: `Cash settlement for closing trade ${order.orderNo}`,
          amount: settlementAmount.toFixed(2),
          entryNature: "CREDIT", // Credit to user cash account
          runningBalance: newCashBalance.toFixed(2),
          transactionDetails: {
            type: null, // Not a deposit or withdrawal
            asset: "CASH",
            previousBalance: currentCashBalance,
          },
          user: order.user,
          adminId: adminId,
          date: new Date(sanitizedData.closingDate),
          notes: `Cash settlement for closed ${order.type} order on ${order.symbol}`,
        });
        await cashTransactionLedgerEntry.save({ session });

        // TRANSACTION ledger entry for gold
        const goldTransactionLedgerEntry = new Ledger({
          entryId: generateEntryId("TRX"),
          entryType: "TRANSACTION",
          referenceNumber: order.orderNo,
          description: `Gold ${
            order.type === "BUY" ? "debit" : "credit"
          } for closing trade ${order.orderNo}`,
          amount: volume,
          entryNature: order.type === "BUY" ? "DEBIT" : "CREDIT", // Debit for BUY (removing gold), Credit for SELL (adding gold)
          runningBalance: newMetalBalance,
          transactionDetails: {
            type: null, // Not a deposit or withdrawal
            asset: "GOLD",
            previousBalance: currentMetalBalance,
          },
          user: order.user,
          adminId: adminId,
          date: new Date(sanitizedData.closingDate),
          notes: `Gold ${
            order.type === "BUY" ? "removed from" : "added to"
          } account for closing ${order.type} order`,
        });
        await goldTransactionLedgerEntry.save({ session });
      }
    }

    await session.commitTransaction();
    committed = true; // Mark transaction as committed

    return {
      order,
      balances: {
        cash: newCashBalance,
        gold: newMetalBalance,
      },
      profit: {
        client: clientProfit,
        lp: lpPosition ? parseFloat(lpPosition.profit) : 0
      },
    };
  } catch (error) {
    // Only abort if we haven't committed yet
    if (!committed) {
      await session.abortTransaction();
    }
    throw new Error(`Error updating trade: ${error.message}`);
  } finally {
    session.endSession();
  }
}
