import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const roles = ["superadmin", "rider", "cook", "supervisor", "refill"];

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: roles, required: true },
    passwordHash: { type: String }, // Optional: Only used for manual authentication
    googleId: { type: String }, // Used for Google OAuth
    auth0Id: { type: String }, // Used for Auth0 OAuth
    disabled: { type: Boolean, default: false },

    // Payroll / Salary fields (all optional)
    currency: { type: String, enum: ["THB", "INR", "USD"], default: undefined },
    baseSalary: { type: Number, default: undefined },
    payFrequency: { type: String, enum: ["Monthly", "Weekly", "Daily", "Hourly"], default: undefined },
    employmentType: { type: String, enum: ["Full-time", "Part-time", "Contract", "Gig / On-demand"], default: undefined },
    vat: { type: Number, default: undefined },
    effectiveFrom: { type: Date, default: undefined },
    otEligible: { type: Boolean, default: undefined },
    otRate: { type: Number, default: undefined },
    allowances: { type: Number, default: undefined },
    deductions: { type: Number, default: undefined },
    taxId: { type: String, trim: true, default: undefined },
    // Store bank details encrypted in bankEnc; do not keep plaintext in documents
    bankEnc: { type: String, default: undefined },
    notes: { type: String, trim: true, default: undefined },
  },
  { timestamps: true }
);

// Helper to set password for manual authentication
UserSchema.methods.setPassword = async function (plain) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plain, salt);
};

// Helper to verify password for manual authentication
UserSchema.methods.verifyPassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

export const User = mongoose.model("User", UserSchema);
export const ROLE_ENUM = roles;
export default User;