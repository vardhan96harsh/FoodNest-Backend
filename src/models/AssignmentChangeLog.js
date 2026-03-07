import mongoose from "mongoose";

const AssignmentChangeLogSchema = new mongoose.Schema(
{
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: "DailyAssignment", required: true },

  type: {
    type: String,
    enum: ["vehicle-change", "battery-change"]
  },

  oldValue: { type: mongoose.Schema.Types.ObjectId },

  newValue: { type: mongoose.Schema.Types.ObjectId },

  reason: { type: String, required: true },

  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }

},
{ timestamps: true }
);

export const AssignmentChangeLog = mongoose.model("AssignmentChangeLog", AssignmentChangeLogSchema);
export default AssignmentChangeLog;