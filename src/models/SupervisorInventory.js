import mongoose from "mongoose";

// Inventory item schema (used in both permanent and daily)
const InventoryItemSchema = new mongoose.Schema(
{
  foodItem: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "FoodItem", 
    required: true 
  },
  quantity: { 
    type: Number, 
    required: true,
    min: 0,
    default: 0
  },
  locked: { 
    type: Number, 
    default: 0,
    min: 0
  },
  manualRestocked: { 
    type: Number, 
    default: 0 
  },
  lastRestockedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ["active", "finished", "archived"],
    default: "active"
  },
  notes: {
    type: String,
    default: ""
  }
},
{ 
  timestamps: true 
}
);

// Permanent Inventory Schema (one per supervisor)
const PermanentInventorySchema = new mongoose.Schema(
{
  supervisor: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    unique: true // One permanent inventory per supervisor
  },
  items: [InventoryItemSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  notes: {
    type: String,
    default: ""
  }
},
{ 
  timestamps: true 
}
);

// Daily Inventory Schema (one per supervisor per day)
const DailyInventorySchema = new mongoose.Schema(
{
  supervisor: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  date: {
    type: Date,
    required: true,
    default: () => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return date;
    }
  },
  items: [InventoryItemSchema],
  status: {
    type: String,
    enum: ["draft", "active", "completed", "closed"],
    default: "draft"
  },
  notes: {
    type: String,
    default: ""
  },
  summary: {
    totalItems: { type: Number, default: 0 },
    totalQuantity: { type: Number, default: 0 },
    totalLocked: { type: Number, default: 0 },
    totalSold: { type: Number, default: 0 },
    totalWasted: { type: Number, default: 0 }
  }
},
{ 
  timestamps: true 
}
);

// Create a compound index for unique daily inventory per supervisor
DailyInventorySchema.index({ supervisor: 1, date: 1 }, { unique: true });

export const PermanentInventory = mongoose.model("PermanentInventory", PermanentInventorySchema);
export const DailyInventory = mongoose.model("DailyInventory", DailyInventorySchema);