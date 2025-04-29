import mongoose from "mongoose";
import Transaction from "../../models/Transaction.js";
import Account from "../../models/AccountSchema.js";
import { createAppError } from "../../utils/errorHandler.js";

const generateOrderNo = () => {
  const timestamp = Date.now().toString();
  const randomStr = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `TRX-${timestamp.substring(timestamp.length - 5)}`;
};

export const createTransaction = async (transactionData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { type, asset, amount, user, adminId } = transactionData;
    const transactionId = generateOrderNo();

    // Find the user account
    const account = await Account.findById(user).session(session);

    if (!account) {
      throw createAppError("Account not found", 404);
    }

    let previousBalance = 0;
    let newBalance = 0;

    // Calculate previous and new balance based on asset type
    if (asset === "CASH") {
      previousBalance = account.AMOUNTFC;

      if (type === "DEPOSIT") {
        newBalance = previousBalance + amount;
      } else if (type === "WITHDRAWAL") {
        if (previousBalance < amount) {
          throw createAppError("Insufficient cash balance for withdrawal", 400);
        }
        newBalance = previousBalance - amount;
      }

      // Update account balance
      account.AMOUNTFC = newBalance;
    } else if (asset === "GOLD") {
      previousBalance = account.METAL_WT;

      if (type === "DEPOSIT") {
        newBalance = previousBalance + amount;
      } else if (type === "WITHDRAWAL") {
        if (previousBalance < amount) {
          throw createAppError("Insufficient gold balance for withdrawal", 400);
        }
        newBalance = previousBalance - amount;
      }

      // Update account balance
      account.METAL_WT = newBalance;
    } else {
      throw createAppError("Invalid asset type", 400);
    }

    // Save the updated account
    await account.save({ session });

    // Create the transaction record
    const transaction = new Transaction({
      transactionId,
      adminId,
      type,
      asset,
      amount,
      user,
      previousBalance,
      newBalance,
      status: "COMPLETED",
    });

    await transaction.save({ session });

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    return transaction;
  } catch (error) {
    // Abort the transaction on error
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const getTransactionsByUser = async (adminId, userId) => {
  try {
    const transactions = await Transaction.find({
      adminId: adminId,
      user: userId
    })
      .populate(
        "user",
        "firstName lastName ACCOUNT_HEAD email phoneNumber accountStatus"
      )
      .sort({ createdAt: -1 });

    return transactions;
  } catch (error) {
    throw createAppError(`Error fetching user transactions: ${error.message}`, 500);
  }
};
/**
 * Get transactions for a specific user with filters
 */
export const getUserTransactions = async (userId, options) => {
  const { page, limit, type, asset, status, startDate, endDate } = options;

  const skip = (page - 1) * limit;

  // Build query filters
  const query = { user: userId };

  if (type) query.type = type;
  if (asset) query.asset = asset;
  if (status) query.status = status;

  // Add date range filter if provided
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  // Get total count for pagination
  const total = await Transaction.countDocuments(query);

  // Get transactions
  const transactions = await Transaction.find(query)
    .populate("user", "REFMID ACCOUNT_HEAD ACCODE firstName lastName email")
    .sort({ date: -1 })
    .skip(skip)
    .limit(limit);

  return {
    transactions,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get transaction by ID
 */
export const getTransactionById = async (transactionId) => {
  return Transaction.findOne({ transactionId }).populate(
    "user",
    "REFMID ACCOUNT_HEAD ACCODE firstName lastName email"
  );
};

/**
 * Update transaction status
 */
export const updateTransactionStatus = async (transactionId, status) => {
  const validStatuses = ["PENDING", "COMPLETED", "FAILED", "CANCELLED"];

  if (!validStatuses.includes(status)) {
    throw createAppError("Invalid transaction status", 400);
  }

  const transaction = await Transaction.findOne({ transactionId });

  if (!transaction) {
    throw createAppError("Transaction not found", 404);
  }

  // If cancelling or failing a completed transaction, we need to reverse the balance update
  if (
    (status === "CANCELLED" || status === "FAILED") &&
    transaction.status === "COMPLETED"
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const account = await Account.findById(transaction.user).session(session);

      if (!account) {
        throw createAppError("Account not found", 404);
      }

      // Reverse the transaction
      if (transaction.asset === "CASH") {
        if (transaction.type === "DEPOSIT") {
          account.AMOUNTFC -= transaction.amount;
        } else if (transaction.type === "WITHDRAWAL") {
          account.AMOUNTFC += transaction.amount;
        }
      } else if (transaction.asset === "GOLD") {
        if (transaction.type === "DEPOSIT") {
          account.METAL_WT -= transaction.amount;
        } else if (transaction.type === "WITHDRAWAL") {
          account.METAL_WT += transaction.amount;
        }
      }

      // Save the updated account
      await account.save({ session });

      // Update the transaction status
      transaction.status = status;
      await transaction.save({ session });

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      return transaction;
    } catch (error) {
      // Abort the transaction on error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  // For simpler status updates
  transaction.status = status;
  await transaction.save();

  return transaction;
};

/**
 * Get all transactions with filters (for admin)
 */
export const getAllTransactions = async (options) => {
  const {
    page,
    limit,
    type,
    asset,
    status,
    startDate,
    endDate,
    userId,
    adminId,
  } = options;

  const skip = (page - 1) * limit;

  // Build query filters
  const query = {};

  if (type) query.type = type;
  if (asset) query.asset = asset;
  if (status) query.status = status;
  if (userId) query.user = userId;
  if (adminId) query.adminId = adminId;
  // Add date range filter if provided
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  // Get total count for pagination
  const total = await Transaction.countDocuments(query);

  // Get transactions
  const transactions = await Transaction.find(query)
    .populate("user", "REFMID ACCOUNT_HEAD ACCODE firstName lastName email")
    .sort({ date: -1 })
    .skip(skip)
    .limit(limit);

  return {
    transactions,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};
