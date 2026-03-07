import mongoose from "mongoose";

const { Schema } = mongoose;

const TeamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },

    supervisors: [{ type: Schema.Types.ObjectId, ref: "User" }],
    riders: [{ type: Schema.Types.ObjectId, ref: "User" }],
    cooks: [{ type: Schema.Types.ObjectId, ref: "User" }],
    refillCoordinators: [{ type: Schema.Types.ObjectId, ref: "User" }],

    vehicles: [{ type: Schema.Types.ObjectId, ref: "Vehicle" }],
    batteries: [{ type: Schema.Types.ObjectId, ref: "Battery" }],
    routes: [{ type: Schema.Types.ObjectId, ref: "Route" }],
  },
  { timestamps: true }
);

TeamSchema.pre("save", async function (next) {
  try {
    const U = (await import("./User.js")).default;

    const validateRole = async (ids, role) => {
      if (!ids?.length) return true;
      const count = await U.countDocuments({ _id: { $in: ids }, role });
      if (count !== ids.length) {
        throw new Error(`One or more ${role} IDs are invalid or have another role`);
      }
      return true;
    };

    // Validate all roles - if any fail, the error will be caught
    await validateRole(this.supervisors, "supervisor");
    await validateRole(this.riders, "rider");
    await validateRole(this.cooks, "cook");
    await validateRole(this.refillCoordinators, "refill");

    // Also validate vehicles, batteries, routes exist
    if (this.vehicles?.length) {
      const Vehicle = mongoose.model("Vehicle");
      const vehicleCount = await Vehicle.countDocuments({ _id: { $in: this.vehicles } });
      if (vehicleCount !== this.vehicles.length) {
        throw new Error("One or more vehicle IDs are invalid");
      }
    }

    if (this.batteries?.length) {
      const Battery = mongoose.model("Battery");
      const batteryCount = await Battery.countDocuments({ _id: { $in: this.batteries } });
      if (batteryCount !== this.batteries.length) {
        throw new Error("One or more battery IDs are invalid");
      }
    }

    if (this.routes?.length) {
      const Route = mongoose.model("Route");
      const routeCount = await Route.countDocuments({ _id: { $in: this.routes } });
      if (routeCount !== this.routes.length) {
        throw new Error("One or more route IDs are invalid");
      }
    }

    next(); // All validations passed
  } catch (error) {
    next(error); // Pass error to Mongoose
  }
});

export const Team = mongoose.model("Team", TeamSchema);