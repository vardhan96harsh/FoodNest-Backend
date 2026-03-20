import express from "express";
import { User } from "../models/User.js";
import { RegistrationRequest } from "../models/RegistrationRequest.js";
import { signToken } from "../utils/jwt.js";
import { auth } from "../middleware/auth.js";
import passport from "passport"; 
import { PasswordReset } from "../models/PasswordReset.js";
import { sendResetOtpEmail } from "../utils/mailer.js";
import crypto from "crypto";


const router = express.Router();

/** POST /api/auth/login {email,password} */

/** POST /api/auth/login {email,password} */
router.post("/login", async (req, res) => {
  const { email, password, provider } = req.body || {};  // Add provider to handle OAuth login

  if (provider === "google" || provider === "auth0") {
    // Handle Google/Auth0 login flow
    passport.authenticate(provider, { session: false }, (err, user, info) => {
      if (err || !user) {
        return res.status(400).json({ error: "Invalid credentials" });
      }
      const token = signToken(user); // Generate JWT token
      res.json({
        token,
        user: { id: user._id, email: user.email, name: user.name, role: user.role },
      });
    })(req, res); // Pass request and response to passport for authentication
  } else {
    // Handle manual email/password login
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken(user);
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role } });
  }
});

/** POST /api/auth/register-request {email,name,role,password} */
router.post("/register-request", async (req, res) => {
  const { email, name, role, password } = req.body || {};
  if (!email || !name || !role || !password) return res.status(400).json({ error: "Missing fields" });

  const allowed = ["rider", "cook", "supervisor", "refill"];
  if (!allowed.includes(role)) return res.status(400).json({ error: "Invalid role" });

  const e = String(email).trim().toLowerCase();
  const n = String(name).trim();

  if (await User.findOne({ email: e })) return res.status(409).json({ error: "Email already exists" });
  if (await RegistrationRequest.findOne({ email: e })) return res.status(409).json({ error: "Request already submitted" });

  const doc = new RegistrationRequest({ email: e, name: n, role, passwordHash: "x" });
  await doc.setPassword(password);
  await doc.save();

  res.status(201).json({ ok: true, id: doc._id });
});

/** GET /api/auth/me  (requires Bearer token) */
router.get("/me", auth, (req, res) => {
  res.json({ user: req.user });
});


// Helpers for OTP
function generateOtp(len = Number(process.env.RESET_OTP_LENGTH || 6)) {
  // numeric string of len digits
  const max = Math.pow(10, len) - 1;
  const n = crypto.randomInt(0, max + 1);
  return String(n).padStart(len, "0");
}
function ttlMinutes() {
  return Number(process.env.RESET_OTP_TTL_MIN || 10);
}

/**
 * POST /api/auth/forgot/request-otp
 * body: { email }
 * Always 200 to avoid user enumeration; include 'ok' and optionally 'hint' for client.
 */
router.post("/forgot/request-otp", async (req, res) => {
  const emailRaw = req.body?.email;
  if (!emailRaw) return res.status(400).json({ error: "Email required" });

  const email = String(emailRaw).trim().toLowerCase();
  const user = await User.findOne({ email });
  // Always proceed (don’t leak existence)
  const code = generateOtp();
  const expires = new Date(Date.now() + ttlMinutes() * 60 * 1000);

  // Invalidate previous unconsumed codes for this email
  await PasswordReset.updateMany({ email, consumed: false }, { $set: { consumed: true } });

  // Create a fresh OTP record (even if user not found; harmless)
  await PasswordReset.create({ email, code, expiresAt: expires });

  // Try to email only if user exists (optional; you can still send generic mail either way)
  if (user) {
    try {
      await sendResetOtpEmail(user.email, user.name, code, ttlMinutes());
    } catch (e) {
      console.error("sendResetOtpEmail error:", e);
      // do not reveal failure to user
    }
  }
  // Always respond OK
  return res.json({ ok: true });
});

/**
 * POST /api/auth/forgot/verify
 * body: { email, code }
 * returns: { ok: true } if valid (client can now show "new password" form)
 */
router.post("/forgot/verify", async (req, res) => {
  const { email: emailRaw, code: codeRaw } = req.body || {};
  if (!emailRaw || !codeRaw) return res.status(400).json({ error: "Email and code required" });

  const email = String(emailRaw).trim().toLowerCase();
  const code = String(codeRaw).trim();

  const doc = await PasswordReset.findOne({ email, consumed: false }).sort({ createdAt: -1 });
  if (!doc) return res.status(400).json({ error: "Invalid or expired code" });

  // Throttle attempts
  const maxAttempts = Number(process.env.RESET_OTP_MAX_ATTEMPTS || 5);
  if (doc.attempts >= maxAttempts) {
    return res.status(429).json({ error: "Too many attempts. Request a new code." });
  }

  // Increment attempts if wrong; consume on success
  if (doc.code !== code) {
    doc.attempts += 1;
    await doc.save();
    return res.status(400).json({ error: "Invalid code" });
  }

  if (new Date() > doc.expiresAt) {
    doc.consumed = true;
    await doc.save();
    return res.status(400).json({ error: "Code expired" });
  }

  // Mark as verified but not yet consumed; client still needs to call /reset
  // We won’t mark consumed here to allow one more step. Optionally issue a short-lived token.
  return res.json({ ok: true });
});

/**
 * POST /api/auth/forgot/reset
 * body: { email, code, newPassword }
 * On success: consume code, set new password.
 */
router.post("/forgot/reset", async (req, res) => {
  const { email: emailRaw, code: codeRaw, newPassword } = req.body || {};
  if (!emailRaw || !codeRaw || !newPassword) {
    return res.status(400).json({ error: "Email, code and new password required" });
  }

  const email = String(emailRaw).trim().toLowerCase();
  const code = String(codeRaw).trim();

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: "Invalid request" });

  const doc = await PasswordReset.findOne({ email, consumed: false }).sort({ createdAt: -1 });
  if (!doc) return res.status(400).json({ error: "Invalid or expired code" });

  // attempts check
  const maxAttempts = Number(process.env.RESET_OTP_MAX_ATTEMPTS || 5);
  if (doc.attempts >= maxAttempts) {
    return res.status(429).json({ error: "Too many attempts. Request a new code." });
  }

  if (doc.code !== code) {
    doc.attempts += 1;
    await doc.save();
    return res.status(400).json({ error: "Invalid code" });
  }
  if (new Date() > doc.expiresAt) {
    doc.consumed = true;
    await doc.save();
    return res.status(400).json({ error: "Code expired" });
  }

  // All good: update password, consume code
  await user.setPassword(String(newPassword));
  await user.save();

  doc.consumed = true;
  await doc.save();

  return res.json({ ok: true });
});



/** Google Callback Route */
router.get("/google/callback", passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    // Successful login via Google, redirect to dashboard
    const token = signToken(req.user); // Generate a token for the authenticated user
    res.json({ token, user: { id: req.user._id, email: req.user.email, name: req.user.name, role: req.user.role } });
  });

/** Auth0 Callback Route */
router.get("/auth0/callback", passport.authenticate("auth0", { failureRedirect: "/" }),
  (req, res) => {
    // Successful login via Auth0, redirect to dashboard
    const token = signToken(req.user); // Generate a token for the authenticated user
    res.json({ token, user: { id: req.user._id, email: req.user.email, name: req.user.name, role: req.user.role } });
  });


export default router;
