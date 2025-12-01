import mongoose from "mongoose";

const batterySchema = new mongoose.Schema(
  {
    imei: { type: String, required: true, unique: true },
   vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },

    type: { type: String, required: true },      // Lithium-ion 48V
    capacity: { type: String, required: true },  // 20Ah
    installationDate: { type: Date, required: true },
    status: { type: String, default: "Active" }, // Active / Faulty / Replaced
    lastChecked: { type: Date, default: Date.now },
     team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
  },
  { timestamps: true }
);

const Battery = mongoose.model("Battery", batterySchema);
export default Battery;
