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
  const U = (await import("./User.js")).default;

  const validateRole = async (ids, role) => {
    if (!ids?.length) return;
    const count = await U.countDocuments({ _id: { $in: ids }, role });
    if (count !== ids.length)
      return next(new Error(`One or more ${role} IDs are invalid or have another role`));
  };

  await validateRole(this.supervisors, "supervisor");
  await validateRole(this.riders, "rider");
  await validateRole(this.cooks, "cook");

  // FINAL CORRECT ROLE
  await validateRole(this.refillCoordinators, "refillCoordinator");

  next();
});

export const Team = mongoose.model("Team", TeamSchema);
