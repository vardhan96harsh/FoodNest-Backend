// models/PrepRequest.js - Add consumption tracking
import mongoose from "mongoose";

const RawMaterialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    qty: { type: Number },
    unit: { type: String, trim: true }
  },
  { _id: false }
);

const QuantitySchema = new mongoose.Schema(
  {
    amount: { type: Number, min: 0 },
    unit: { type: String, trim: true }
  },
  { _id: false }
);

// NEW: Track consumed raw materials
const ConsumedMaterialSchema = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial" },
  name: String,
  quantityConsumed: Number,
  unit: String,
  previousStock: Number,
  newStock: Number,
  consumedAt: Date
}, { _id: false });

const PrepRequestSchema = new mongoose.Schema(
  {
    foodId: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem", required: true },
    
    // immutable snapshot of the food card at the time of sending
    foodSnapshot: {
      name: { type: String, required: true },
      price: Number,
      category: String,
      tax: Number,
      available: Boolean,
      imageUrl: String,
      rawMaterials: { type: [RawMaterialSchema], default: [] },
      totalQuantity: { type: QuantitySchema, default: undefined },
      perServing: { type: QuantitySchema, default: undefined },
    },

    cookId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    status: { type: String, enum: ["queued", "processing", "ready", "picked"], default: "queued" },
    quantityToPrepare: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    
    // NEW: Raw material consumption tracking
    rawMaterialsConsumed: [ConsumedMaterialSchema],
    materialsConsumedAt: Date,
    
    // NEW: Auto-deduct flag
    autoDeductMaterials: { type: Boolean, default: true },
    
    // NEW: Stock check before starting
    stockCheckedAt: Date,
    stockCheckPassed: Boolean,
    stockCheckNotes: String
  },
  { timestamps: true }
);

PrepRequestSchema.index({ cookId: 1, status: 1, createdAt: -1 });
PrepRequestSchema.index({ requestedBy: 1, createdAt: -1 });

export const PrepRequest = mongoose.model("PrepRequest", PrepRequestSchema);
export default PrepRequest;