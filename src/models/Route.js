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

    // CHANGE: Allow multiple teams (routes can be shared)
    teams: [{ type: mongoose.Schema.Types.ObjectId, ref: "Team" }],

    // Keep single team for backward compatibility (will be deprecated)
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

// Virtual to get primary team (first one) if needed
RouteSchema.virtual('primaryTeam').get(function() {
  return this.teams && this.teams.length > 0 ? this.teams[0] : this.team;
});

// Method to check if route belongs to a specific team
RouteSchema.methods.belongsToTeam = function(teamId) {
  return this.teams && this.teams.some(t => t.toString() === teamId.toString());
};

// Pre-save middleware to maintain backward compatibility
RouteSchema.pre('save', function(next) {
  // If teams array is empty but team field exists, populate teams
  if ((!this.teams || this.teams.length === 0) && this.team) {
    this.teams = [this.team];
  }
  // If teams array has values but team field is empty, set team to first value
  if (this.teams && this.teams.length > 0 && !this.team) {
    this.team = this.teams[0];
  }
  next();
});

export const Route = mongoose.model("Route", RouteSchema);
export default Route;