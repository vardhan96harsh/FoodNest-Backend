import mongoose from "mongoose";

const serviceRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    type: { type: String, required: true }, // Maintenance / Repair
    description: { type: String, default: "" },
    cost: { type: Number, default: 0 },
    mechanic: { type: String, default: "" },
  },
  { _id: false }
);

const vehicleSchema = new mongoose.Schema(
  {
    // ⭐ MAIN VEHICLE DETAILS
    registrationNo: { type: String, required: true },
    name: { type: String, required: true }, // E-cart 01
    type: { type: String, required: true }, // Vehicle type
    status: { type: String, enum: ["Available", "Issue"], default: "Available" },

    // ⭐ BATTERY REFERENCE (from Battery model)
    battery: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Battery",
      default: null,
    },

    // ⭐ SERVICE RECORDS INSIDE VEHICLE
    serviceRecords: [serviceRecordSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Vehicle", vehicleSchema);
