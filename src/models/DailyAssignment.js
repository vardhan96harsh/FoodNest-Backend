import mongoose from "mongoose";

const StopTrackingSchema = new mongoose.Schema(
{
  stopName: String,

  arrivedAt: Date,

  completedAt: Date,

  durationMinutes: Number,

  status: {
    type: String,
    enum: ["pending", "in-progress", "completed"],
    default: "pending"
  }
},
{ _id:false }
);

const InventorySchema = new mongoose.Schema(
{
  foodItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FoodItem"
  },

  name: String,

  quantityAssigned: Number,

  quantitySold: {
    type:Number,
    default:0
  },

  quantityRemaining:Number
},
{ _id:false }
);

const DailyAssignmentSchema = new mongoose.Schema(
{
  date:{
    type:Date,
    required:true
  },

  team:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Team"
  },

  route:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Route"
  },

  supervisor:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User"
  },

  rider:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User"
  },

  refillCoordinator:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User"
  },

  vehicle:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Vehicle"
  },

  battery:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Battery"
  },

  startTime:Date,

  endTime:Date,

  status:{
    type:String,
    enum:["active","completed"],
    default:"active"
  },

  inventory:[InventorySchema],

  stops:[StopTrackingSchema],

  currentLocation:{
    lat:Number,
    lng:Number,
    updatedAt:Date
  },

  createdBy:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User"
  }

},
{timestamps:true}
);

export const DailyAssignment = mongoose.model("DailyAssignment",DailyAssignmentSchema);
export default DailyAssignment;