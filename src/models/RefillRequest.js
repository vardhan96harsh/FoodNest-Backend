// models/RefillRequest.js
import mongoose from "mongoose";

const RefillRequestSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: "AssignmentSession" },
  rider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  items: [
    {
      item: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem" },
      quantity: Number
    }
  ],

  status: {
    type: String,
    enum: ["Pending", "Approved", "CookPreparing", "ReadyForDelivery", "Delivered", "Rejected"],
    default: "Pending"
  },

  remark: String,

  refillCoordinator: { type: mongoose.Schema.Types.ObjectId, ref: "User" }

}, { timestamps: true });

export default mongoose.model("RefillRequest", RefillRequestSchema);