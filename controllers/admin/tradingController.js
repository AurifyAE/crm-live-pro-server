import * as tradingServices from '../../services/admin/tradingServices.js';

export const createTrade = async (req, res, next) => {
  try {
    const { adminId } = req.params;
    const { userId } = req.body;
    const tradeData = req.body;
    
    const newTrade = await tradingServices.createTrade(adminId, userId, tradeData);
    
    res.status(201).json({
      status: 201,
      success: true,
      message: "Trade created successfully",
      data: newTrade.clientOrder
    });
  } catch (error) {
    next(error);
  }
};

export const getUserTrades = async (req, res, next) => {
  try {
    const { adminId } = req.params;
    
    const trades = await tradingServices.getTradesByUser(adminId);
    
    res.json({
      status: 200,
      success: true,
      message: "User trades retrieved successfully",
      data: trades
    });
  } catch (error) {
    next(error);
  }
};
export const getUserOrdersByAdmin = async (req, res, next) => {
  try {
    const { adminId, userId } = req.params;
    
    const orders = await tradingServices.getOrdersByUser(adminId, userId);
    
    res.json({
      status: 200,
      success: true,
      message: "User orders retrieved successfully",
      data: orders
    });
  } catch (error) {
    next(error);
  }
};

export const getLPTrades = async (req, res, next) => {
  try {
    const { adminId } = req.params;
    
    const trades = await tradingServices.getTradesByLP(adminId);
    
    res.json({
      status: 200,
      success: true,
      message: "LP trades retrieved successfully",
      data: trades
    });
  } catch (error) {
    next(error);
  }
};

export const getTrade = async (req, res, next) => {
  try {
    const { adminId, tradeId } = req.params;
    
    const trade = await tradingServices.getTradeById(adminId, tradeId);
    
    if (!trade) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Trade not found or you don't have permission to view this trade"
      });
    }
    
    res.json({
      status: 200,
      success: true,
      message: "Trade retrieved successfully",
      data: trade
    });
  } catch (error) {
    next(error);
  }
};

export const updateTrade = async (req, res, next) => {
  try {
    const { adminId, orderId } = req.params;
    const updateData = req.body;
    
    const updatedTrade = await tradingServices.updateTradeStatus(adminId, orderId, updateData);
    
    if (!updatedTrade) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Trade not found or you don't have permission to update this trade"
      });
    }
    
    res.json({
      status: 200,
      success: true,
      message: "Trade updated successfully",
      data: updatedTrade
    });
  } catch (error) {
    next(error);
  }
};
