import Account from "../../models/AccountSchema.js";
import Order from "../../models/OrderSchema.js";
import { MINIMUM_BALANCE_PERCENTAGE, BASE_AMOUNT_PER_VOLUME } from "../../utils/constants.js";

export const getUserBalance = async (accountId) => {
  try {
    const account = await Account.findById(accountId);
    return account ? { cash: account.AMOUNTFC, gold: account.METAL_WT } : { cash: 0, gold: 0 };
  } catch (error) {
    console.error("Error fetching user balance:", error);
    return { cash: 0, gold: 0 };
  }
};

export const checkSufficientBalance = async (accountId, volume) => {
  try {
    const account = await Account.findById(accountId);
    if (!account || !account.AMOUNTFC) {
      return { success: false, message: "User account information not available" };
    }

    const userBalance = parseFloat(account.AMOUNTFC);
    const volumeValue = parseInt(volume) || 0;
    if (volumeValue <= 0) {
      return { success: false, message: "Volume must be at least 1" };
    }

    const baseAmount = volumeValue * BASE_AMOUNT_PER_VOLUME;
    const marginRequirement = baseAmount * (MINIMUM_BALANCE_PERCENTAGE / 100);
    const totalRequiredAmount = baseAmount + marginRequirement;

    const openOrders = await Order.find({ user: accountId, orderStatus: "PROCESSING" });
    const existingVolume = openOrders.reduce((total, order) => total + (parseInt(order.volume) || 0), 0);
    const existingOrdersAmount = existingVolume * BASE_AMOUNT_PER_VOLUME;
    const existingOrdersMargin = existingOrdersAmount * (MINIMUM_BALANCE_PERCENTAGE / 100);
    const totalExistingAmount = existingOrdersAmount + existingOrdersMargin;
    const totalNeededAmount = totalRequiredAmount + totalExistingAmount;
    const remainingBalance = userBalance - totalNeededAmount;
    const maxAllowedVolume = Math.floor(
      (userBalance - totalExistingAmount) /
      (BASE_AMOUNT_PER_VOLUME * (1 + MINIMUM_BALANCE_PERCENTAGE / 100))
    );

    const isTradeValid = remainingBalance >= 0 && volumeValue > 0;

    return {
      success: isTradeValid,
      userBalance: userBalance.toFixed(2),
      baseAmount: baseAmount.toFixed(2),
      marginAmount: marginRequirement.toFixed(2),
      totalAmount: totalRequiredAmount.toFixed(2),
      existingVolume,
      existingAmount: totalExistingAmount.toFixed(2),
      totalNeededAmount: totalNeededAmount.toFixed(2),
      remainingBalance: remainingBalance.toFixed(2),
      remainingPercentage: ((remainingBalance / userBalance) * 100).toFixed(1),
      maxAllowedVolume,
      message: isTradeValid ? "Sufficient balance for trade" : `Insufficient balance. Maximum allowed volume is ${maxAllowedVolume}`,
    };
  } catch (error) {
    console.error("Error checking sufficient balance:", error);
    return { success: false, message: "Error checking account balance" };
  }
};