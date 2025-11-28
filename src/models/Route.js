import mongoose from "mongoose";

const StopSchema = new mongoose.Schema({
  name: { type: String, required: true },
  lat: Number,
  lng: Number,
  status: {
    type: String,
    enum: ["pending", "in-progress", "completed"],
    default: "pending"
  }
});

const RouteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    region: { type: String, required: true },

    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },

    // Assigned users (Supervisor can update these)
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    refillCoordinator: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    stops: [StopSchema],

    lastLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date,
    },

    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export const Route = mongoose.model("Route", RouteSchema);
export default Route;
