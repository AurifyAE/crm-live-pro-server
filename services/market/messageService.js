import { fetchLatestTTBPrices } from "../../services/market/priceService.js";
import { checkSufficientBalance, getUserBalance } from "../../services/market/balanceService.js";
import { processOrderPlacement, processOrderClose, storeUserOrdersInSession } from "./orderService.js";
import marketDataService, { isPriceFresh } from "../../services/market/marketDataService.js";
import Ledger from "../../models/LedgerSchema.js";
import { formatLedgerForDisplay } from "./ledgerService.js";

export const parseShortOrderCommand = (input) => {
  input = input.trim().toUpperCase();
  
  const fullCommandWithTTBMatch = input.match(/^(BUY|SELL)\s+(\d+\.?\d*)\s*TTB$/i);
  if (fullCommandWithTTBMatch) {
    return { action: fullCommandWithTTBMatch[1], volume: parseFloat(fullCommandWithTTBMatch[2]) };
  }
  
  const fullCommandMatch = input.match(/^(BUY|SELL)\s+(\d+\.?\d*)$/i);
  if (fullCommandMatch) {
    return { action: fullCommandMatch[1], volume: parseFloat(fullCommandMatch[2]) };
  }
  
  const shortCommandMatch = input.match(/^(\d+\.?\d*)TTB$/i);
  if (shortCommandMatch) {
    return { action: "BUY", volume: parseFloat(shortCommandMatch[1]) };
  }
  
  const justNumberMatch = input.match(/^(\d+\.?\d*)$/i);
  if (justNumberMatch) {
    return { action: "BUY", volume: parseFloat(justNumberMatch[1]) };
  }
  
  return null;
};

export const getMainMenu = async () => {
  marketDataService.requestSymbols(["GOLD"]);
  const ttbPrices = await fetchLatestTTBPrices();
  const ttbAskPrice = ttbPrices.askPrice ? ttbPrices.askPrice.toFixed(2) : "N/A";
  const ttbBidPrice = ttbPrices.bidPrice ? ttbPrices.bidPrice.toFixed(2) : "N/A";
  let goldAskPrice = "N/A";
  let goldBidPrice = "N/A";

  if (isPriceFresh("GOLD")) {
    const goldData = marketDataService.getMarketData("GOLD");
    if (goldData) {
      goldAskPrice = (goldData.offer !== undefined ? goldData.offer : goldData.askPrice)?.toFixed(2) || "N/A";
      goldBidPrice = (goldData.bid !== undefined ? goldData.bid : goldData.bidPrice)?.toFixed(2) || "N/A";
    }
  }

  const priceAge = ttbPrices.timestamp ? Date.now() - ttbPrices.timestamp : Infinity;
  const priceStatus = priceAge < 60000 ? "Live Prices" : priceAge < 300000 ? "Prices updated in the last 5 min" : "Delayed Prices";

  return `*Welcome to Hija Global Markets*\n\n*${priceStatus}*:\n• Gold Buy: $${goldAskPrice}/oz | Sell: $${goldBidPrice}/oz\n• TTB Buy: $${ttbAskPrice} | Sell: $${ttbBidPrice}\n\n*Choose an option:*\n\n1️⃣ Buy TTB\n2️⃣ Sell TTB\n3️⃣ Statement\n4️⃣ Orders/Positions\n5️⃣ Balance\n\n*Shortcuts:*\n• Type "2" or "2TTB" to buy 2 units of TTB\n• Type "BUY 3 TTB" to buy 3 units of TTB\n• Type "SELL 3 TTB" to sell 3 units of TTB\n• Type "PRICE" for latest prices`;
};

export const getPriceMessage = async () => {
  const ttbPrices = await fetchLatestTTBPrices();
  const ttbAskPrice = ttbPrices.askPrice ? ttbPrices.askPrice.toFixed(2) : "N/A";
  const ttbBidPrice = ttbPrices.bidPrice ? ttbPrices.bidPrice.toFixed(2) : "N/A";
  let goldAskPrice = "N/A";
  let goldBidPrice = "N/A";

  if (isPriceFresh("GOLD")) {
    const goldData = marketDataService.getMarketData("GOLD");
    if (goldData) {
      goldAskPrice = (goldData.offer !== undefined ? goldData.offer : goldData.askPrice)?.toFixed(2) || "N/A";
      goldBidPrice = (goldData.bid !== undefined ? goldData.bid : goldData.bidPrice)?.toFixed(2) || "N/A";
    }
  }

  const lastUpdate = ttbPrices.timestamp ? new Date(ttbPrices.timestamp).toLocaleTimeString() : "Unknown";
  return `*Market Prices* (as of ${lastUpdate}):\n\n*Gold:*\n• Buy: $${goldAskPrice}/oz\n• Sell: $${goldBidPrice}/oz\n\n*TTB:*\n• Buy: $${ttbAskPrice}\n• Sell: $${ttbBidPrice}`;
};

export const getOrdersMessage = async (session) => {
  const orders = await storeUserOrdersInSession(session);
  if (orders.length === 0) return "You have no open positions.";
  
  let response = "*Your Open Positions:*\n\n";
  orders.forEach((order, index) => {
    const timestamp = new Date(order.openingDate).toLocaleString();
    const profit = order.profit !== undefined ? ` | Profit: $${order.profit.toFixed(2)}` : '';
    response += `*${index + 1}.* ${order.type} ${order.volume} TTB @ $${order.openingPrice.toFixed(2)}\n   Date: ${timestamp}${profit}\n   *To close:* Send "CLOSE ${index + 1}"\n\n`;
  });
  
  return response;
};

export const getLedgerStatement = async (session, limit = 10) => {
  try {
    const ledgerEntries = await Ledger.find({ user: session.accountId })
      .sort({ date: -1 })
      .limit(limit);
    
    if (ledgerEntries.length === 0) {
      return "No transactions found in your statement.";
    }
    
    return formatLedgerForDisplay(ledgerEntries);
  } catch (error) {
    console.error("Error fetching ledger statement:", error);
    return "Error fetching your statement. Please try again later.";
  }
};

// Helper function to format the statement as text, mimicking the Excel layout
const formatStatementAsText = async (userId, userName, session) => {
  const ledgerEntries = await Ledger.find({ user: userId })
    .sort({ date: -1 })
    .limit(10)
    .lean();

  let response = `*HIJA GLOBAL MARKETS*\n\n*4000050 ${userName.toUpperCase()} STATEMENT FROM 01/04/2025 TO 07/04/2025*\n\n`;
  response += `----------------------------------------\n`;
  response += `*SL.NO. | ORDER NO. | OPEN DATE | POSITION | QTY | OPEN PRICE | CLOSE DATE | CLOSE PRICE | P/L (AED)*\n`;
  response += `----------------------------------------\n`;

  let totalProfitLoss = 0;
  ledgerEntries.forEach((entry, index) => {
    if (entry.entryType !== "ORDER") return; // Only process ORDER entries
    const slNo = (index + 1).toString().padEnd(6);
    const orderNo = (entry.orderDetails?.orderNo || "N/A").padEnd(10);
    const openDate = new Date(entry.date).toLocaleDateString("en-GB").padEnd(10);
    const openPosition = (entry.orderDetails?.type || "N/A").padEnd(9);
    const qty = `${entry.orderDetails?.volume || 0} TTB`.padEnd(6);
    const openPrice = `$${entry.orderDetails?.entryPrice?.toFixed(2) || "N/A"}`.padEnd(11);
    const closeDate = (entry.orderDetails?.status === "CLOSED" ? new Date(entry.orderDetails.closeDate).toLocaleDateString("en-GB") : "N/A").padEnd(11);
    const closePrice = (entry.orderDetails?.status === "CLOSED" ? `$${entry.orderDetails?.exitPrice?.toFixed(2) || "N/A"}` : "N/A").padEnd(12);
    const profitLoss = (entry.orderDetails?.profit ? entry.orderDetails.profit.toFixed(2) : "0").padEnd(9);

    response += `${slNo} | ${orderNo} | ${openDate} | ${openPosition} | ${qty} | ${openPrice} | ${closeDate} | ${closePrice} | ${profitLoss}\n`;
    totalProfitLoss += parseFloat(profitLoss) || 0;
  });

  response += `----------------------------------------\n`;
  response += `*TOTAL P/L:* ${totalProfitLoss.toFixed(2)} AED\n\n`;

  // Add open positions summary
  const openOrders = await storeUserOrdersInSession({ accountId: userId, openOrders: [] });
  if (openOrders.length > 0) {
    response += `*OPEN POSITION & PROFIT OR LOSS AT CURRENT PRICE*\n\n`;
    response += `----------------------------------------\n`;
    response += `*QTY | OPEN RATE | POSITION | MARKET PRICE | LOSS @ MARKET RATE*\n`;
    response += `----------------------------------------\n`;

    let totalSummaryLoss = 0;
    openOrders.forEach((order) => {
      const ttbPrices = { bidPrice: 1926.48 }; // Mock price; fetch real prices in production
      const marketPrice = ttbPrices.bidPrice;
      const openRate = order.openingPrice;
      const qty = order.volume;
      const loss = (openRate - marketPrice) * qty;
      totalSummaryLoss += loss;

      response += `${qty.toString().padEnd(3)} | ${openRate.toFixed(2).padEnd(10)} | ${order.type.toLowerCase().padEnd(9)} | ${marketPrice.toFixed(2).padEnd(12)} | -${Math.abs(loss).toFixed(2).padEnd(15)}\n`;
    });

    response += `----------------------------------------\n`;
    response += `*TOTAL LOSS:* ${totalSummaryLoss.toFixed(2)}\n`;
  }

  return response;
};

export const processUserInput = async (inputText, session, twilioClient, from, to) => {
  const input = inputText.trim().toLowerCase();
  marketDataService.requestSymbols(["GOLD"]);

  if (input === "menu" || input === "main" || input === "home") {
    session.state = "MAIN_MENU";
    return await getMainMenu();
  } else if (input === "orders" || input === "positions") {
    return await getOrdersMessage(session);
  } else if (input === "more" && session.state === "STATEMENT") {
    session.statementPage = (session.statementPage || 1) + 1;
    return await getLedgerStatement(session, 10 * session.statementPage);
  }

  if (session.state === "MAIN_MENU" || session.state === "START") {
    if (input === "1") {
      session.currentOrder = { type: "BUY" };
      session.state = "SELECT_QUANTITY";
      const ttbPrices = await fetchLatestTTBPrices();
      return `*Buy TTB*\n\nHow many units of TTB would you like to buy?\nCurrent buy price: $${ttbPrices.askPrice.toFixed(2)}\n\n(Enter a number or type "CANCEL" to return to menu)`;
    } 
    else if (input === "2") {
      session.currentOrder = { type: "SELL" };
      session.state = "SELECT_QUANTITY";
      const ttbPrices = await fetchLatestTTBPrices();
      return `*Sell TTB*\n\nHow many units of TTB would you like to sell?\nCurrent sell price: $${ttbPrices.bidPrice.toFixed(2)}\n\n(Enter a number or type "CANCEL" to return to menu)`;
    }
    else if (input === "3") {
      session.state = "STATEMENT";
      session.statementPage = 1;
      
      // Format the statement as text instead of XLSX
      const statementText = await formatStatementAsText(session.accountId, session.userName || "User", session);
      return statementText;
    }
    else if (input === "4") {
      return await getOrdersMessage(session);
    }
    else if (input === "5") {
      const balance = await getUserBalance(session.accountId);
      return `*Your Current Balance:*\n• Cash: $${balance.cash.toFixed(2)}\n• Gold: ${balance.gold.toFixed(2)} TTB`;
    }
  }

  const shortcodeCommand = parseShortOrderCommand(inputText);
  if (shortcodeCommand) {
    const balanceCheck = await checkSufficientBalance(session.accountId, shortcodeCommand.volume);
    if (!balanceCheck.success) {
      return `⚠️ *Insufficient balance*\n\nBalance: $${balanceCheck.userBalance}\nRequired: $${balanceCheck.totalAmount}\nExisting positions: $${balanceCheck.existingAmount}\nMax volume: ${balanceCheck.maxAllowedVolume}`;
    }

    session.currentOrder = { type: shortcodeCommand.action, quantity: shortcodeCommand.volume };
    const ttbPrices = await fetchLatestTTBPrices();
    const ttbPrice = shortcodeCommand.action === "BUY" ? ttbPrices.askPrice : ttbPrices.bidPrice;
    const priceAge = Date.now() - ttbPrices.timestamp;
    const priceFreshness = priceAge < 60000 ? "Live" : "Delayed";
    const total = shortcodeCommand.volume * ttbPrice;

    session.state = "CONFIRM_ORDER";
    return `*Order Summary:*\n• Action: ${shortcodeCommand.action} TTB\n• Quantity: ${shortcodeCommand.volume} TTB\n• Price: $${ttbPrice.toFixed(2)}/TTB (${priceFreshness})\n• Total: $${total.toFixed(2)}\n\n*Reply with "Y" to confirm or "N" to cancel.*`;
  }

  const closeCommandMatch = inputText.toUpperCase().match(/^CLOSE\s+(.+)$/);
  if (closeCommandMatch) {
    const closeParam = closeCommandMatch[1].trim();
    let orderId;
    const orderIndex = parseInt(closeParam) - 1;

    if (!isNaN(orderIndex) && orderIndex >= 0) {
      await storeUserOrdersInSession(session);
      if (!session.openOrders || orderIndex >= session.openOrders.length) {
        return `⚠️ Invalid order number. Check open positions with "ORDERS".`;
      }
      orderId = session.openOrders[orderIndex]._id;
    } else {
      orderId = closeParam;
    }

    const result = await processOrderClose(session, orderId);
    if (result.success) {
      await storeUserOrdersInSession(session);
      return `✅ Order ${result.orderNo} closed successfully.\n\n*Results:*\n• Profit: $${result.profit}\n• New balances:\n  - Cash: $${result.newCashBalance}\n  - Gold: ${result.newGoldBalance} TTB`;
    }
    return `❌ Failed to close order: ${result.message}`;
  }

  switch (session.state) {
    case "START":
      session.state = "MAIN_MENU";
      return await getMainMenu();
    
    case "MAIN_MENU":
      if (input.includes("buy")) {
        session.currentOrder = { type: "BUY" };
        session.state = "SELECT_QUANTITY";
        const ttbPrices = await fetchLatestTTBPrices();
        return `*Buy TTB*\n\nHow many units of TTB would you like to buy?\nCurrent buy price: $${ttbPrices.askPrice.toFixed(2)}\n\n(Enter a number or type "CANCEL" to return to menu)`;
      } 
      else if (input.includes("sell")) {
        session.currentOrder = { type: "SELL" };
        session.state = "SELECT_QUANTITY";
        const ttbPrices = await fetchLatestTTBPrices();
        return `*Sell TTB*\n\nHow many units of TTB would you like to sell?\nCurrent sell price: $${ttbPrices.bidPrice.toFixed(2)}\n\n(Enter a number or type "CANCEL" to return to menu)`;
      } 
      else if (input.includes("statement")) {
        session.state = "STATEMENT";
        session.statementPage = 1;
        const statementText = await formatStatementAsText(session.accountId, session.userName || "User", session);
        return statementText;
      } 
      else if (input.includes("balance")) {
        const balance = await getUserBalance(session.accountId);
        return `*Your Current Balance:*\n• Cash: $${balance.cash.toFixed(2)}\n• Gold: ${balance.gold.toFixed(2)} TTB`;
      }
      return await getMainMenu();
    
    case "SELECT_QUANTITY":
      const quantity = parseFloat(input);
      if (!isNaN(quantity) && quantity > 0) {
        const balanceCheck = await checkSufficientBalance(session.accountId, quantity);
        if (!balanceCheck.success) {
          return `⚠️ *Insufficient balance*\n\nBalance: $${balanceCheck.userBalance}\nRequired: $${balanceCheck.totalAmount}\nExisting positions: $${balanceCheck.existingAmount}\nMax volume: ${balanceCheck.maxAllowedVolume}`;
        }

        const orderType = session.currentOrder.type;
        const ttbPrices = await fetchLatestTTBPrices();
        const ttbPrice = orderType === "BUY" ? ttbPrices.askPrice : ttbPrices.bidPrice;
        session.currentOrder.quantity = quantity;
        session.currentOrder.price = ttbPrice;
        session.currentOrder.total = quantity * ttbPrice;
        const priceAge = Date.now() - ttbPrices.timestamp;
        const priceFreshness = priceAge < 60000 ? "Live" : "Delayed";
        session.state = "CONFIRM_ORDER";

        return `*Order Summary:*\n• Action: ${orderType} TTB\n• Quantity: ${quantity} TTB\n• Price: $${ttbPrice.toFixed(2)}/TTB (${priceFreshness})\n• Total: $${session.currentOrder.total.toFixed(2)}\n\n*Reply with "Y" to confirm or "N" to cancel.*`;
      }
      return "Please enter a valid quantity (a positive number) or type 'CANCEL' to return to menu.";
    
    case "CONFIRM_ORDER":
      if (input === "y" || input.includes("yes")) {
        const result = await processOrderPlacement(session, session.currentOrder.quantity, session.currentOrder.type);
        session.state = "MAIN_MENU";
        if (result.success) {
          await storeUserOrdersInSession(session);
          const orderIndex = session.openOrders.findIndex((order) => order._id.toString() === result.orderId.toString()) + 1;
          return `✅ *Trade Successful!*\n\nOrder No: ${result.orderNo}\n\n*Details:*\n• Action: ${session.currentOrder.type} TTB\n• Quantity: ${result.volume} TTB\n• Price: $${result.price.toFixed(2)}/oz\n• Total: $${result.total}\n\n*To close:* Send "CLOSE ${orderIndex}"`;
        }
        return `❌ Order failed: ${result.message}\n\nPlease try again or contact support.`;
      } else if (input === "n" || input.includes("no") || input.includes("cancel")) {
        session.state = "MAIN_MENU";
        return "Order cancelled.\n\n" + (await getMainMenu());
      }
      return "Please reply with Y to confirm or N to cancel.";
    
    case "STATEMENT":
      session.state = "MAIN_MENU";
      return "What would you like to do next?\n\n" + (await getMainMenu());
    
    default:
      session.state = "MAIN_MENU";
      return await getMainMenu();
  }
};