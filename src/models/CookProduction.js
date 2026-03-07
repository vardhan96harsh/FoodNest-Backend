// models/CookProduction.js
import mongoose from "mongoose";

const CookProductionSchema = new mongoose.Schema({
  dateKey: { type: String, required: true },
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  cook: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  items: [
    {
      item: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem", required: true },
      quantity: { type: Number, required: true },
      remark: { type: String }
    }
  ],

  status: { type: String, enum: ["Pending", "Completed"], default: "Pending" },

  completedAt: Date
}, { timestamps: true });

export default mongoose.model("CookProduction", CookProductionSchema);