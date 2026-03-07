// models/RefillDeliveryLog.js
import mongoose from "mongoose";

const RefillDeliverySchema = new mongoose.Schema({
  refillRequest: { type: mongoose.Schema.Types.ObjectId, ref: "RefillRequest" },
  refillCoordinator: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  deliveredItems: [
    {
      item: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem" },
      quantity: Number
    }
  ],

  deliveredAt: Date,
  remark: String
}, { timestamps: true });

export default mongoose.model("RefillDeliveryLog", RefillDeliverySchema);