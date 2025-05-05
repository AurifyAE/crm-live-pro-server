import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema(
  {
    orderNo: {
      type: String,
      unique: true,
      required: true,
    },
    type: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true,
    },
    volume: {
      type: Number,
      required: true,
      min: 0.01,
    },
    symbol: {
      type: String,
      required: true,
    },
    requiredMargin: {
      type: Number,
      default: 0,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    openingPrice: {
      type: Number,
      required: true,
    },
    closingPrice: {
      type: Number,
      default: null,
    },
    stopLoss: {
      type: Number,
      default: 0,
    },
    takeProfit: {
      type: Number,
      default: 0,
    },
    time: {
      type: Date,
      default: Date.now,
    },
    openingDate: {
      type: Date,
      default: Date.now,
    },
    closingDate: {
      type: Date,
      default: null,
    },
    orderStatus: {
      type: String,
      enum: ["PROCESSING", "EXECUTED", "CANCELLED", "CLOSED", "PENDING"],
      default: "PROCESSING",
    },
    profit: {
      type: Number,
      default: 0,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    lpPositionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LPPosition",
      default: null,
    },
    comment: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", OrderSchema);

export default Order;
