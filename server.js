// server.js (updated version)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import adminRouter from './routers/admin/index.js'
import superAdminRouter from './routers/superAdmin/index.js'
import chatRouter from './routers/chat/index.js'
import { mongodb } from "./config/connection.js";
import { errorHandler } from "./utils/errorHandler.js";
// Import the market service to initialize it when the server starts
// import "./services/market/marketDataService.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4444;

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' })); // Increase JSON payload limit
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Increase URL-encoded payload limit

// CORS configuration - BEFORE other middleware
const corsOptions = {
  // Specify allowed origins explicitly instead of using wildcard when credentials are enabled
  origin: function(origin, callback) {
    // Allow any origin to access your API
    // For production, you should list specific domains
    const allowedOrigins = ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Add more origins as needed for your app
      callback(null, true); // Allow all origins for now, change in production
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ['Content-Type', 'x-secret-key', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Apply CORS first
app.use(cors(corsOptions));

// Database connecting
mongodb();

// Routes
app.use("/api/admin", adminRouter);
app.use("/api", superAdminRouter);
app.use("/api/chat", chatRouter);

// Global error handling middleware
app.use(errorHandler);

app.listen(port, () => {
  console.log("Server running !!!!!");
  console.log(`http://localhost:${port}`);
});