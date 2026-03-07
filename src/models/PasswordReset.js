import mongoose from "mongoose";

const PasswordResetSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumed: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// TTL index - automatically delete expired documents
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Also index for quick lookups
PasswordResetSchema.index({ email: 1, consumed: 1, createdAt: -1 });

export const PasswordReset = mongoose.model("PasswordReset", PasswordResetSchema);
export default PasswordReset;