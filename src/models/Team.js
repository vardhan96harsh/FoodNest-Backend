// src/models/Team.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const TeamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },

    supervisors: [{ type: Schema.Types.ObjectId, ref: "User" }],
    riders: [{ type: Schema.Types.ObjectId, ref: "User" }],
    cooks: [{ type: Schema.Types.ObjectId, ref: "User" }],

    refillCoordinators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    refillStaff: [{ type: Schema.Types.ObjectId, ref: "User" }],

    routes: [{ type: Schema.Types.ObjectId, ref: "Route" }],
  },
  { timestamps: true }
);

// Validate roles: supervisor, rider, cook, refillCoordinator, refillStaff
TeamSchema.pre("save", async function (next) {
  const U = (await import("./User.js")).default || (await import("./User.js")).User;

  const check = async (ids, role) => {
    if (!ids?.length) return;
    const count = await U.countDocuments({ _id: { $in: ids }, role });
    if (count !== ids.length) {
      return next(new Error(`One or more ${role} IDs are invalid or have another role`));
    }
  };

  await check(this.supervisors, "supervisor");
  await check(this.riders, "rider");
  await check(this.cooks, "cook");
  await check(this.refillCoordinators, "refillCoordinater");
  await check(this.refillStaff, "refillStaff");

  next();
});

export const Team = mongoose.model("Team", TeamSchema);
