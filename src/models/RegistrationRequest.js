import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./User.js";

const roles = ["rider", "cook", "supervisor", "refill"];

const RegistrationRequestSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name:  { type: String, required: true, trim: true },
    role:  { type: String, enum: roles, required: true },
    passwordHash: { type: String, default: "google-oauth" }, // optional for Google users
    googleId: { type: String },   // set for Google users
    auth0Id:  { type: String },   // set for Google users
    loginType: { type: String, enum: ["manual", "google"], default: "manual" },
  },
  { timestamps: true }
);

RegistrationRequestSchema.methods.setPassword = async function (plain) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plain, salt);
};

RegistrationRequestSchema.methods.approve = async function () {
  const userData = {
    email: this.email,
    name: this.name,
    role: this.role,
  };

  // Google user — no password needed
  if (this.loginType === "google") {
    userData.googleId  = this.googleId;
    userData.auth0Id   = this.auth0Id;
    userData.passwordHash = "google-oauth"; // placeholder
  } else {
    userData.passwordHash = this.passwordHash;
  }

  const user = new User(userData);
  await user.save();
  await this.deleteOne();
  return user;
};

export const RegistrationRequest = mongoose.model(
  "RegistrationRequest",
  RegistrationRequestSchema
);