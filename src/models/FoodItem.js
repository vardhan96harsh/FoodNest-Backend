import mongoose from "mongoose";

// Raw Material Schema
const RawMaterialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    qty: { type: Number },
    unit: { type: String, trim: true }
  },
  { _id: false }
);

// Quantity Schema
const QuantitySchema = new mongoose.Schema(
  {
    amount: { type: Number, min: 0 },
    unit: { type: String, trim: true }
  },
  { _id: false }
);

// Food Item Schema
const FoodItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, trim: true },
    available: { type: Boolean, default: true },
    tax: { type: Number, default: 0, min: 0 },
    imageUrl: { type: String, default: null },
    imagePath: { type: String, default: null },
    rawMaterials: { type: [RawMaterialSchema], default: [] },
    totalQuantity: { type: QuantitySchema, default: undefined },
    perServing: { type: QuantitySchema, default: undefined },

    // Permanent Item Fields
    isPermanent: {
      type: Boolean,
      default: false,
      description: "Always present in daily inventory (e.g., water, soft drinks)"
    },

    defaultStock: {
      type: Number,
      default: 0,
      min: 0,
      description: "Default quantity to add manually for permanent items"
    },

    autoRestock: {
      type: Boolean,
      default: false,
      description: "Automatically add defaultStock to inventory each day"
    },

    reorderLevel: {
      type: Number,
      default: 10,
      min: 0,
      description: "Alert when stock falls below this level"
    },

    unit: {
      type: String,
      enum: ["ml", "L", "g", "kg", "piece", "packet", "bottle", "can", "box"],
      default: "piece"
    }
  },
  { timestamps: true }
);

export const FoodItem = mongoose.model("FoodItem", FoodItemSchema);
export default FoodItem;