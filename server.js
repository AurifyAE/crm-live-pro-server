import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import adminRouter from './routers/admin/index.js'
import superAdminRouter from './routers/superAdmin/index.js'
import { mongodb } from "./config/connection.js";
import { errorHandler } from "./utils/errorHandler.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4444;

app.use(express.static('public'));
app.use(express.json({ limit: '50mb' })); // Increase JSON payload limit
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Increase URL-encoded payload limit

// Custom middleware to check for secret key - moved after CORS
const checkSecretKey = (req, res, next) => {
  // Skip secret key check for preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return next();
  }
  
  const secretKey = req.headers["x-secret-key"];
  if (secretKey !== process.env.API_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
};

// CORS configuration - BEFORE other middleware
const corsOptions = {
  origin: ['https://crm-live-pro.onrender.com'], // Allow your frontend domains
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ['Content-Type', 'x-secret-key', 'Authorization'],
  credentials: true,
};

// Apply CORS first
app.use(cors(corsOptions));

// Then apply secret key check
app.use(checkSecretKey);

// Database connecting
mongodb();

// Routes
app.use("/api/admin", adminRouter);
app.use("/api", superAdminRouter);

// Global error handling middleware
app.use(errorHandler);

app.listen(port, () => {
  console.log("server running !!!!!");
  console.log(`http://localhost:${port}`);
});