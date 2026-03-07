import mongoose from "mongoose";

const InventoryItemSchema = new mongoose.Schema(
{
  foodItem: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem", required: true },

  quantity: { type: Number, required: true },

  locked: { type: Number, default: 0 }

},
{ _id: false }
);

const SupervisorInventorySchema = new mongoose.Schema(
{
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  date: { type: Date, required: true },

  items: [InventoryItemSchema]

},
{ timestamps: true }
);

export const SupervisorInventory = mongoose.model("SupervisorInventory", SupervisorInventorySchema);
export default SupervisorInventory;