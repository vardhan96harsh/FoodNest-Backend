import mongoose from "mongoose";

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
    min: 0
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
  }
},
{ 
  timestamps: true,
  _id: false 
}
);

const SupervisorInventorySchema = new mongoose.Schema(
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

export const SupervisorInventory = mongoose.model("SupervisorInventory", SupervisorInventorySchema);
export default SupervisorInventory;