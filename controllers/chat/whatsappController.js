import pkg from "twilio";
const { Twilio } = pkg;
import dotenv from "dotenv";
import { getUserSession, resetSession } from "../../services/market/sessionService.js";
import { isAuthorizedUser } from "../../services/market/userService.js";
import { getPriceMessage, processUserInput, getOrdersMessage } from "../../services/market/messageService.js";
import { getUserBalance } from "../../services/market/balanceService.js";
import { getMainMenu } from "../../services/market/messageService.js";
import marketDataService from "../../services/market/marketDataService.js";

dotenv.config();

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const client = new Twilio(accountSid, authToken);

export const handleWhatsAppWebhook = async (req, res) => {
  try {
    // Extract message data
    const { Body, From, ProfileName } = req.body;
    
    if (!Body || !From) {
      console.log("Missing required parameters:", req.body);
      return res.status(400).send("Missing required parameters");
    }
    
    // Ensure fresh market data
    marketDataService.requestSymbols(["GOLD"]);
    
    // Check user authorization
    const authResult = await isAuthorizedUser(From);
    if (!authResult.isAuthorized) {
      console.log("Unauthorized user:", From);
      const responseMessage = `🚫 *Access Denied*\n\nYour number is not registered.\nContact support:\n📞 *Ajmal TK* – Aurify Technologies\n📱 +971 58 502 3411\n\nWe're here to help! 💬`;
      const twiml = new pkg.twiml.MessagingResponse();
      twiml.message(responseMessage);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twiml.toString());
      return;
    }
    
    // Get user session
    const userSession = getUserSession(From);
    userSession.accountId = authResult.accountId;
    
    // Store user name if available
    if (ProfileName && !userSession.userName) {
      userSession.userName = ProfileName;
    }
    
    let responseMessage;
    
    // Handle special commands
    const trimmedBody = Body?.trim().toLowerCase();
    
    switch (trimmedBody) {
      case "reset":
        resetSession(From);
        responseMessage = await getMainMenu();
        break;
        
      case "hi":
      case "hello":
      case "start":
        userSession.state = "MAIN_MENU";
        responseMessage = `Hello ${userSession.userName || "there"}! 👋\n\n` + (await getMainMenu());
        break;
        
      case "balance":
      case "5":
        const balance = await getUserBalance(userSession.accountId);
        responseMessage = `*Your Current Balance:*\n• Cash: $${balance.cash.toFixed(2)}\n• Gold: ${balance.gold.toFixed(2)} oz`;
        break;
        
      case "cancel":
        responseMessage =
          userSession.state === "CONFIRM_ORDER"
            ? "Your order has been cancelled.\n\n" + (await getMainMenu())
            : "No active order to cancel.\n\n" + (await getMainMenu());
        userSession.state = "MAIN_MENU";
        break;
        
      case "price":
      case "prices":
        responseMessage = await getPriceMessage();
        break;
        
      case "orders":
      case "positions":
      case "4":
        responseMessage = await getOrdersMessage(userSession);
        break;
        
      case "refresh":
        marketDataService.requestSymbols(["GOLD"]);
        responseMessage = "🔄 Refreshing market data... Type 'PRICE' to check updated prices.";
        break;
        
      case "menu":
      case "help":
        userSession.state = "MAIN_MENU";
        responseMessage = await getMainMenu();
        break;
        
      default:
        // Pass the Twilio client, From, and twilioPhoneNumber to processUserInput
        responseMessage = await processUserInput(Body, userSession, client, From, `whatsapp:${twilioPhoneNumber}`);
    }
    
    // If processUserInput already sent a media message (e.g., for the statement), we skip sending a text message
    if (responseMessage) {
      const twiml = new pkg.twiml.MessagingResponse();
      twiml.message(responseMessage);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twiml.toString());
    } else {
      // If no responseMessage, assume the media message was sent in processUserInput
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(new pkg.twiml.MessagingResponse().toString());
    }
    
    console.log("Response sent to", From);
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    res.status(500).send("Error processing WhatsApp webhook");
  }
};