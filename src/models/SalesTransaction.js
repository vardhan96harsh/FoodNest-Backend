import mongoose from "mongoose";

const SalesTransactionSchema = new mongoose.Schema(
{
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: "DailyAssignment", required: true },

  rider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  foodItem: { type: mongoose.Schema.Types.ObjectId, ref: "FoodItem", required: true },

  quantity: { type: Number, required: true },

  price: { type: Number, required: true },

  total: { type: Number, required: true },

  soldAt: { type: Date, default: Date.now }

},
{ timestamps: true }
);

export const SalesTransaction = mongoose.model("SalesTransaction", SalesTransactionSchema);
export default SalesTransaction;