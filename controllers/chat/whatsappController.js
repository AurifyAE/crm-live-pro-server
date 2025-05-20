// controllers/whatsapp/whatsappController.js
import pkg from "twilio";
const { Twilio } = pkg;
import dotenv from "dotenv";
import Account from "../../models/AccountSchema.js";
import Order from "../../models/OrderSchema.js";
import Admin from "../../models/AdminSchema.js";
import { createTrade } from "../../services/admin/tradingServices.js";
import { updateTradeStatus } from "../../services/admin/tradingServices.js";
import marketDataService, {
  getCurrentPrices,
  getLivePrice,
  generateOrderId,
  isPriceFresh,
} from "../../services/market/marketDataService.js";

dotenv.config();

// Initialize Twilio client with environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = new Twilio(accountSid, authToken);

// Constants for gold pricing and conversion
const TROY_OUNCE_GRAMS = 31.103;
const GOLD_CONVERSION_FACTOR = 3.674;
const TTB_FACTOR = 116.64;

// TTB product with backup fixed price (used only if live prices are unavailable)
const TTB_BACKUP_PRICE = 0;

// User session storage
const userSessions = {};

// Clean phone number helper function
const cleanPhoneNumber = (phoneNumber) => {
  return phoneNumber.replace("whatsapp:", "").replace("+", "");
};

const getUserSession = (phoneNumber) => {
  // Clean the phone number to remove "whatsapp:" prefix and any '+' signs
  const cleanNumber = cleanPhoneNumber(phoneNumber);

  if (!userSessions[cleanNumber]) {
    userSessions[cleanNumber] = {
      state: "START",
      cart: {},
      lastActivity: Date.now(),
      currentOrder: null,
      accountId: null,
      adminId: null,
      openOrders: [], // Store open orders in session for easy reference
    };
  }

  // Update last activity
  userSessions[cleanNumber].lastActivity = Date.now();
  return userSessions[cleanNumber];
};

// Store user open orders in session to make it easy to reference by number
const storeUserOrdersInSession = async (session) => {
  try {
    const orders = await Order.find({
      user: session.accountId,
      orderStatus: "PROCESSING",
    }).sort({ createdAt: -1 });

    // Store orders in session for easy reference
    session.openOrders = orders;
    return orders;
  } catch (error) {
    console.error("Error fetching and storing user orders:", error);
    return [];
  }
};

// Update the isAuthorizedUser function - unchanged
const isAuthorizedUser = async (phoneNumber) => {
  try {
    // Clean the phone number for database lookup
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    console.log(cleanNumber);
    // Find the account with matching phone number
    const account = await Account.findOne({
      phoneNumber: { $regex: cleanNumber, $options: "i" },
    });

    if (account) {
      return {
        isAuthorized: true,
        accountId: account._id,
        accountDetails: account,
      };
    }

    return { isAuthorized: false };
  } catch (error) {
    console.error("Error checking authorized user:", error);
    return { isAuthorized: false };
  }
};

const getAdminUser = async () => {
  try {
    // Fetch the first admin user
    // You might want to implement a more specific selection criteria
    const admin = await Admin.findOne({});
    return admin;
  } catch (error) {
    console.error("Error fetching admin user:", error);
    return null;
  }
};

// Calculate TTB price from gold price
const calculateTTBPrice = (goldPrice) => {
  if (!goldPrice || isNaN(goldPrice)) return null;
  // TTB = (Gold price per ounce / grams in troy ounce) * conversion factor * TTB factor
  return (goldPrice / TROY_OUNCE_GRAMS) * GOLD_CONVERSION_FACTOR * TTB_FACTOR;
};

// Enhanced function to get latest TTB prices calculated from gold price
const fetchLatestTTBPrices = async () => {
  try {
    // First try to get TTB prices directly from the market data service
    // This utilizes the service's cached data and staleness checks
    const ttbPrices = marketDataService.getTTBPrices();

    if (ttbPrices) {
      console.log("Using TTB prices from market data service:", ttbPrices);
      return {
        askPrice: ttbPrices.offer || ttbPrices.askPrice,
        bidPrice: ttbPrices.bid || ttbPrices.bidPrice,
        timestamp: ttbPrices.timestamp,
      };
    }

    // If that fails, check if we have fresh gold prices and calculate TTB prices
    if (isPriceFresh("GOLD")) {
      const goldData = marketDataService.getMarketData("GOLD");

      if (goldData) {
        // Use the new offer/bid properties if available, fallback to askPrice/bidPrice
        const askPrice =
          goldData.offer !== undefined ? goldData.offer : goldData.askPrice;
        const bidPrice =
          goldData.bid !== undefined ? goldData.bid : goldData.bidPrice;

        if (askPrice && bidPrice) {
          return {
            askPrice: calculateTTBPrice(askPrice),
            bidPrice: calculateTTBPrice(bidPrice),
            timestamp: marketDataService.lastUpdated.get("GOLD"),
          };
        }
      }
    }

    // If market data service is not providing fresh data, force a refresh
    console.log("Requesting fresh market data for GOLD");
    marketDataService.requestSymbols(["GOLD"]);

    // Fallback to static prices if market data is stale or unavailable
    console.log("Using fallback prices - market data is stale or unavailable");
    return {
      askPrice: TTB_BACKUP_PRICE,
      bidPrice: TTB_BACKUP_PRICE * 0.995, // Slight discount for sell price
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Error fetching TTB prices:", error);
    return {
      askPrice: TTB_BACKUP_PRICE,
      bidPrice: TTB_BACKUP_PRICE * 0.995,
      timestamp: Date.now(),
    };
  }
};

const getUserBalance = async (accountId) => {
  try {
    const account = await Account.findById(accountId);
    if (!account) return { cash: 0, gold: 0 };

    return {
      cash: account.AMOUNTFC,
      gold: account.METAL_WT,
    };
  } catch (error) {
    console.error("Error fetching user balance:", error);
    return { cash: 0, gold: 0 };
  }
};

// Updated getUserOrders function to use the session cache
const getUserOrders = async (session) => {
  try {
    // Fetch and store orders in session
    const orders = await storeUserOrdersInSession(session);
    return orders;
  } catch (error) {
    console.error("Error fetching user orders:", error);
    return [];
  }
};

const processOrderPlacement = async (session, volume, type) => {
  try {
    // Get admin for the order
    const admin = await getAdminUser();
    if (!admin) throw new Error("No admin user found");

    const symbol = "GOLD"; // Always TTB

    // Ensure we have the latest market data
    marketDataService.requestSymbols(["GOLD"]);

    // Get direct gold prices instead of TTB prices
    let goldPrice = 0;
    let marketDataTimestamp = Date.now();
    const ttbPrices = await fetchLatestTTBPrices();

    // Updated logic to correctly assign price based on order type
    // For BUY orders, use the askPrice (offer price)
    // For SELL orders, use the bidPrice (bid price)
    const ttbPrice = type === "BUY" ? ttbPrices.askPrice : ttbPrices.bidPrice;

    if (!ttbPrice || ttbPrice === 0) {
      throw new Error(
        "Unable to get valid market price. Please try again later."
      );
    }

    // Check if we have fresh gold price data
    if (isPriceFresh("GOLD")) {
      const goldData = marketDataService.getMarketData("GOLD");

      if (goldData) {
        // Use the appropriate gold price based on order type
        // For BUY orders, use the ask/offer price
        // For SELL orders, use the bid price
        if (type === "BUY") {
          goldPrice =
            goldData.offer !== undefined ? goldData.offer : goldData.askPrice;
        } else {
          goldPrice =
            goldData.bid !== undefined ? goldData.bid : goldData.bidPrice;
        }

        marketDataTimestamp = marketDataService.lastUpdated.get("GOLD");
      }
    }

    if (!goldPrice || goldPrice === 0) {
      throw new Error(
        "Unable to get valid gold market price. Please try again later."
      );
    }

    // Calculate required margin based on volume and gold price
    const requiredMargin = goldPrice * volume;

    // Generate an order number
    const orderNo = generateOrderId("ORD");

    const tradeData = {
      orderNo,
      type,
      volume,
      symbol,
      price: goldPrice,
      requiredMargin,
      openingPrice: goldPrice,
      openingDate: new Date(),
      marketDataTimestamp,
    };

    // Create the trade using the trading service
    const tradeResult = await createTrade(
      admin._id,
      session.accountId,
      tradeData
    );

    return {
      success: true,
      orderNo,
      symbol,
      volume,
      price: ttbPrice,
      total: requiredMargin.toFixed(2),
      orderId: tradeResult.clientOrder._id, // Return the actual MongoDB ID
    };
  } catch (error) {
    console.error("Error placing order:", error);
    return {
      success: false,
      message: error.message || "Failed to place order",
    };
  }
};

// Enhanced version of processOrderClose function
const processOrderClose = async (session, orderId) => {
  try {
    // Get admin user
    const admin = await getAdminUser();
    if (!admin) throw new Error("No admin user found");

    // Find the order to make sure it exists and belongs to this user
    const order = await Order.findOne({
      _id: orderId,
      user: session.accountId,
      orderStatus: "PROCESSING", // Only close open orders
    });

    if (!order) {
      return {
        success: false,
        message: "Order not found or already closed",
      };
    }

    // Ensure we have the latest market data for accurate closing price
    marketDataService.requestSymbols(["GOLD"]);

    // Get current price for the closing
    // For closing BUY orders, we use the bid price (SELL price)
    // For closing SELL orders, we use the ask price (BUY price)
    const closeType = order.type === "BUY" ? "SELL" : "BUY";

    // Get TTB prices directly
    const ttbPrices = await fetchLatestTTBPrices();
    const currentPrice =
      closeType === "BUY" ? ttbPrices.askPrice : ttbPrices.bidPrice;

    if (!currentPrice || currentPrice === 0) {
      return {
        success: false,
        message:
          "Unable to get valid market price for closing. Please try again shortly.",
      };
    }

    // Prepare data for closing the trade
    const updateData = {
      orderStatus: "CLOSED",
      closingPrice: currentPrice,
      closingDate: new Date(),
      marketDataTimestamp: ttbPrices.timestamp,
    };

    // Call the update trade status function with the correct admin ID
    const result = await updateTradeStatus(admin._id, orderId, updateData);

    return {
      success: true,
      orderNo: order.orderNo,
      symbol: order.symbol,
      volume: order.volume,
      openPrice: order.openingPrice,
      closePrice: currentPrice,
      profit: result.profit.client?.toFixed(2) || 0,
      newCashBalance: result.balances.cash.toFixed(2),
      newGoldBalance: result.balances.gold.toFixed(2),
    };
  } catch (error) {
    console.error("Error closing order:", error);
    return {
      success: false,
      message: error.message || "Failed to close order",
    };
  }
};

// Updated parseShortOrderCommand function
const parseShortOrderCommand = (input) => {
  input = input.trim().toUpperCase();

  // Pattern for "{action} {volume}TTB" like "BUY 2TTB" or "SELL 3TTB"
  const fullCommandWithTTBMatch = input.match(/^(BUY|SELL)\s+(\d+\.?\d*)TTB$/i);
  if (fullCommandWithTTBMatch) {
    return {
      action: fullCommandWithTTBMatch[1],
      volume: parseFloat(fullCommandWithTTBMatch[2]),
    };
  }

  // Pattern for "{action} {volume}" like "BUY 2" or "SELL 3"
  const fullCommandMatch = input.match(/^(BUY|SELL)\s+(\d+\.?\d*)$/i);
  if (fullCommandMatch) {
    return {
      action: fullCommandMatch[1],
      volume: parseFloat(fullCommandMatch[2]),
    };
  }

  // Pattern for just "{volume}TTB" like "4TTB" (assumes BUY as default)
  const shortCommandMatch = input.match(/^(\d+\.?\d*)TTB$/i);
  if (shortCommandMatch) {
    return {
      action: "BUY", // Default to BUY
      volume: parseFloat(shortCommandMatch[1]),
    };
  }

  // Pattern for just "{volume}" like "4" (assumes BUY as default)
  const justNumberMatch = input.match(/^(\d+\.?\d*)$/i);
  if (justNumberMatch) {
    return {
      action: "BUY", // Default to BUY
      volume: parseFloat(justNumberMatch[1]),
    };
  }

  return null;
};

// Updated processUserInput function
const processUserInput = async (inputText, session) => {
  const input = inputText.trim().toLowerCase();

  // Force a refresh of market data at the beginning of processing
  marketDataService.requestSymbols(["GOLD"]);

  // First check for shortcode commands like "4", "4TTB", "BUY 3" regardless of state
  const shortcodeCommand = parseShortOrderCommand(inputText);
  if (shortcodeCommand) {
    console.log("Detected shortcode command:", shortcodeCommand);
    session.currentOrder = {
      type: shortcodeCommand.action,
      quantity: shortcodeCommand.volume,
    };

    // Get TTB prices
    const ttbPrices = await fetchLatestTTBPrices();
    const ttbPrice =
      shortcodeCommand.action === "BUY"
        ? ttbPrices.askPrice
        : ttbPrices.bidPrice;

    // Add price freshness indicator
    const priceAge = Date.now() - ttbPrices.timestamp;
    const priceFreshness = priceAge < 60000 ? "Live" : "Delayed";

    // Skip straight to confirmation
    session.state = "CONFIRM_ORDER"; // Make sure to set the state

    // Calculate total for clarity
    const total = shortcodeCommand.volume * ttbPrice;

    return `Order summary:\nAction: ${shortcodeCommand.action} TTB\nQuantity: ${
      shortcodeCommand.volume
    } oz\nPrice: $${ttbPrice.toFixed(
      2
    )}/oz (${priceFreshness})\nTotal: $${total.toFixed(
      2
    )}\n\nReply with "Y" to confirm or "N" to cancel.`;
  }

  // Check for "CLOSE" command - can now be followed by an order ID or a number
  const closeCommandMatch = inputText.toUpperCase().match(/^CLOSE\s+(.+)$/);
  if (closeCommandMatch) {
    const closeParam = closeCommandMatch[1].trim();
    let orderId;

    // Check if it's a number (like "CLOSE 1") or an order ID
    const orderIndex = parseInt(closeParam) - 1;

    if (!isNaN(orderIndex) && orderIndex >= 0) {
      // It's a number, get the order ID from session
      if (!session.openOrders || orderIndex >= session.openOrders.length) {
        // Need to fetch orders first or index is out of bounds
        await storeUserOrdersInSession(session);

        if (!session.openOrders || orderIndex >= session.openOrders.length) {
          return `Invalid order number. Please check your open positions with "ORDERS" command.`;
        }
      }

      // Get the order ID from the session
      orderId = session.openOrders[orderIndex]._id;
    } else {
      // Assume it's an actual order ID
      orderId = closeParam;
    }

    const result = await processOrderClose(session, orderId);

    if (result.success) {
      // Update the orders in session after closing
      await storeUserOrdersInSession(session);

      return `Order ${result.orderNo} closed successfully.\nProfit: $${result.profit}\nNew balances:\nCash: $${result.newCashBalance}\nGold: ${result.newGoldBalance} oz`;
    } else {
      return `Failed to close order: ${result.message}`;
    }
  }

  // Now process based on state
  switch (session.state) {
    case "START":
      session.state = "MAIN_MENU";
      return getMainMenu();

    case "MAIN_MENU":
      if (input === "1" || input.includes("buy")) {
        session.currentOrder = {
          type: "BUY",
        };
        session.state = "SELECT_QUANTITY";

        // Get current price for reference
        const ttbPrices = await fetchLatestTTBPrices();
        const ttbBuyPrice = ttbPrices.askPrice;

        return `How many units of TTB would you like to buy?\nCurrent buy price: $${ttbBuyPrice.toFixed(
          2
        )}`;
      } else if (input === "2" || input.includes("sell")) {
        session.currentOrder = {
          type: "SELL",
        };
        session.state = "SELECT_QUANTITY";

        // Get current price for reference
        const ttbPrices = await fetchLatestTTBPrices();
        const ttbSellPrice = ttbPrices.bidPrice;

        return `How many units of TTB would you like to sell?\nCurrent sell price: $${ttbSellPrice.toFixed(
          2
        )}`;
      } else if (
        input === "3" ||
        input.includes("statement") ||
        input === "balance"
      ) {
        session.state = "CHECK_BALANCE";
        const balance = await getUserBalance(session.accountId);
        return `Your current balance:\nCash: $${balance.cash.toFixed(
          2
        )}\nGold: ${balance.gold.toFixed(2)} oz`;
      } else if (input.includes("orders") || input.includes("positions")) {
        // Show open orders and store them in session for easy reference
        const orders = await getUserOrders(session);
        if (orders.length === 0) {
          return "You have no open positions at this time.";
        }

        let response = "Your open positions:\n\n";
        orders.forEach((order, index) => {
          response += `${index + 1}. Order ID: ${order._id}\n`;
          response += `   ${order.type} ${order.volume} TTB @ $${order.openingPrice}\n`;
          response += `   To close: Send "CLOSE ${index + 1}" or "CLOSE ${
            order._id
          }"\n\n`;
        });

        return response;
      } else {
        return getMainMenu();
      }

    case "SELECT_QUANTITY":
      const quantity = parseFloat(input);
      if (!isNaN(quantity) && quantity > 0) {
        const orderType = session.currentOrder.type;

        // Get the TTB prices
        const ttbPrices = await fetchLatestTTBPrices();
        const ttbPrice =
          orderType === "BUY" ? ttbPrices.askPrice : ttbPrices.bidPrice;

        session.currentOrder.quantity = quantity;
        session.currentOrder.price = ttbPrice;

        // Calculate total based on price
        session.currentOrder.total = quantity * ttbPrice;

        // Add price freshness indicator
        const priceAge = Date.now() - ttbPrices.timestamp;
        const priceFreshness = priceAge < 60000 ? "Live" : "Delayed";

        session.state = "CONFIRM_ORDER";

        return `Order summary:\nAction: ${orderType} TTB\nQuantity: ${quantity} oz\nPrice: $${session.currentOrder.price.toFixed(
          2
        )}/oz (${priceFreshness})\nTotal: $${session.currentOrder.total.toFixed(
          2
        )}\n\nReply with "Y" to confirm or "N" to cancel.`;
      } else {
        return "Please enter a valid quantity (a positive number).";
      }

    case "CONFIRM_ORDER":
      if (input === "y" || input.includes("yes")) {
        try {
          // Refresh market data before placing the order
          marketDataService.requestSymbols(["GOLD"]);

          const result = await processOrderPlacement(
            session,
            session.currentOrder.quantity,
            session.currentOrder.type
          );

          if (result.success) {
            session.state = "MAIN_MENU"; // Reset the state

            // Update stored orders in session
            await storeUserOrdersInSession(session);

            // Find the order index in the session
            const orderIndex =
              session.openOrders.findIndex(
                (order) => order._id.toString() === result.orderId.toString()
              ) + 1;

            return `Your trade order is placed for Order No: ${
              result.orderNo
            }\n\nAction: ${session.currentOrder.type} TTB\nQuantity: ${
              result.volume
            } oz\nPrice: $${result.price.toFixed(2)}/oz\nTotal: $${
              result.total
            }\nOrder ID: ${
              result.orderId
            }\n\nTo close this position later, send "CLOSE ${orderIndex}" or "CLOSE ${
              result.orderId
            }"`;
          } else {
            session.state = "MAIN_MENU"; // Reset the state to main menu even on failure
            return `Order failed: ${result.message}\n\nPlease try again or contact support.`;
          }
        } catch (error) {
          console.error("Order processing error:", error);
          session.state = "MAIN_MENU";
          return "Sorry, there was an error processing your order. Please try again later.";
        }
      } else if (
        input === "n" ||
        input.includes("no") ||
        input.includes("cancel")
      ) {
        session.state = "MAIN_MENU";
        return (
          "Order cancelled. What would you like to do next?\n\n" + getMainMenu()
        );
      } else {
        return "Please reply with Y to confirm or N to cancel your order.";
      }

    case "CHECK_BALANCE":
      session.state = "MAIN_MENU";
      return "What would you like to do next?\n\n" + getMainMenu();

    default:
      session.state = "MAIN_MENU";
      return getMainMenu();
  }
};

// Enhanced getMainMenu with better live data handling
const getMainMenu = async () => {
  // Ensure we have the latest data
  marketDataService.requestSymbols(["GOLD"]);

  // Get live prices for the menu
  const ttbPrices = await fetchLatestTTBPrices();
  let ttbAskPrice = ttbPrices.askPrice ? ttbPrices.askPrice.toFixed(2) : "N/A";
  let ttbBidPrice = ttbPrices.bidPrice ? ttbPrices.bidPrice.toFixed(2) : "N/A";

  // Get gold price directly from market data service
  let goldAskPrice = "N/A";
  let goldBidPrice = "N/A";

  if (isPriceFresh("GOLD")) {
    const goldData = marketDataService.getMarketData("GOLD");
    if (goldData) {
      // Use the new offer/bid properties if available, fallback to askPrice/bidPrice
      goldAskPrice =
        (goldData.offer !== undefined
          ? goldData.offer
          : goldData.askPrice
        )?.toFixed(2) || "N/A";
      goldBidPrice =
        (goldData.bid !== undefined
          ? goldData.bid
          : goldData.bidPrice
        )?.toFixed(2) || "N/A";
    }
  }

  // Add price freshness indicator
  const priceAge = ttbPrices.timestamp
    ? Date.now() - ttbPrices.timestamp
    : Infinity;
  const priceStatus =
    priceAge < 60000
      ? "Live Prices"
      : priceAge < 300000
      ? "Prices updated in the last 5 min"
      : "Delayed Prices";

  return `Welcome to Hija Global Markets\n\n${priceStatus}:\nGold Buy: $${goldAskPrice}/oz | Sell: $${goldBidPrice}/oz\nTTB Buy: $${ttbAskPrice} | Sell: $${ttbBidPrice}\n\nHow can I assist you?\n\n1. Buy TTB\n2. Sell TTB\n3. Statement\n\nShortcuts:\n- Type '2' or '2TTB' to buy 2 units of TTB\n- Type 'BALANCE' to check your balance\n- Type 'ORDERS' to see open positions\n- Type 'PRICE' for latest prices`;
};

export const handleWhatsAppWebhook = async (req, res) => {
  try {
    // Extract message data from the request
    const { Body, From, NumMedia } = req.body;

    if (!Body || !From) {
      console.log("Missing required parameters:", req.body);
      return res.status(400).send("Missing required parameters");
    }

    // Ensure we have fresh market data at the beginning of each request
    marketDataService.requestSymbols(["GOLD"]);

    // Check if user is authorized by querying the database
    const authResult = await isAuthorizedUser(From);
    if (!authResult.isAuthorized) {
      console.log("Unauthorized user attempted to access:", From);
      const responseMessage =
        `🚫 *Access Denied*\n\n` +
        `Your number is not registered with our service.\n` +
        `Please contact our support team for quick assistance:\n\n` +
        `📞 *Ajmal TK* – Aurify Technologies\n` +
        `📱 +971 58 502 3411\n\n` +
        `We’re here to help you! 💬`;

      const twiml = new pkg.twiml.MessagingResponse();
      twiml.message(responseMessage);

      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twiml.toString());
      return;
    }

    // Get or initialize user session
    const userSession = getUserSession(From);
    // Store the account ID in the session
    userSession.accountId = authResult.accountId;

    // Pre-fetch orders for this user and store in session for quick reference
    await storeUserOrdersInSession(userSession);

    let responseMessage;

    // Special commands that work regardless of state
    if (Body?.toLowerCase() === "reset") {
      userSession.state = "START";
      responseMessage = await getMainMenu();
    } else if (
      Body?.toLowerCase() === "hi" ||
      Body?.toLowerCase() === "hello"
    ) {
      userSession.state = "MAIN_MENU";
      responseMessage = await getMainMenu();
    } else if (Body?.toLowerCase() === "balance") {
      // Get actual balance from database
      const balance = await getUserBalance(userSession.accountId);
      responseMessage = `Your current balance:\nCash: $${balance.cash.toFixed(
        2
      )}\nGold: ${balance.gold.toFixed(2)} oz`;
    } else if (Body?.toLowerCase() === "cancel") {
      if (userSession.state === "CONFIRM_ORDER") {
        userSession.state = "MAIN_MENU";
        responseMessage =
          "Your order has been cancelled. What else would you like to do?\n\n" +
          (await getMainMenu());
      } else {
        responseMessage =
          "No active order to cancel. How can I help you today?\n\n" +
          (await getMainMenu());
      }
    } else if (
      Body?.toLowerCase() === "price" ||
      Body?.toLowerCase() === "prices"
    ) {
      // Return current gold and TTB prices with enhanced information
      const ttbPrices = await fetchLatestTTBPrices();
      let ttbAskPrice = ttbPrices.askPrice
        ? ttbPrices.askPrice.toFixed(2)
        : "N/A";
      let ttbBidPrice = ttbPrices.bidPrice
        ? ttbPrices.bidPrice.toFixed(2)
        : "N/A";

      let goldAskPrice = "N/A";
      let goldBidPrice = "N/A";

      if (isPriceFresh("GOLD")) {
        const goldData = marketDataService.getMarketData("GOLD");
        if (goldData) {
          // Use the new offer/bid properties if available, fallback to askPrice/bidPrice
          goldAskPrice =
            (goldData.offer !== undefined
              ? goldData.offer
              : goldData.askPrice
            )?.toFixed(2) || "N/A";
          goldBidPrice =
            (goldData.bid !== undefined
              ? goldData.bid
              : goldData.bidPrice
            )?.toFixed(2) || "N/A";
        }
      }

      // Add timestamp for price freshness transparency
      const lastUpdate = ttbPrices.timestamp
        ? new Date(ttbPrices.timestamp).toLocaleTimeString()
        : "Unknown";

      responseMessage = `Market Prices (as of ${lastUpdate}):\n\nGold:\n- Buy: $${goldAskPrice}/oz\n- Sell: $${goldBidPrice}/oz\n\nTTB:\n- Buy: $${ttbAskPrice}\n- Sell: $${ttbBidPrice}`;
    } else if (Body?.toLowerCase() === "refresh") {
      // Force a refresh of market data
      marketDataService.requestSymbols(["GOLD"]);
      responseMessage =
        "Refreshing market data... Please check prices again in a moment with 'PRICE' command.";
    } else {
      // Process normal flow based on current state
      responseMessage = await processUserInput(Body, userSession);
    }

    // Respond using TwiML
    const twiml = new pkg.twiml.MessagingResponse();
    twiml.message(responseMessage);

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());

    console.log("Response sent:", responseMessage);
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    res.status(500).send("Error processing WhatsApp webhook");
  }
};

export const sendWhatsAppMessage = async (to, body) => {
  try {
    // Format phone number for WhatsApp
    const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const formattedFrom = twilioPhoneNumber.startsWith("whatsapp:")
      ? twilioPhoneNumber
      : `whatsapp:${twilioPhoneNumber}`;

    // Send message through Twilio
    const message = await client.messages.create({
      body,
      from: formattedFrom,
      to: formattedTo,
    });

    console.log(`WhatsApp message sent: ${message.sid}`);
    return message;
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    throw error;
  }
};
