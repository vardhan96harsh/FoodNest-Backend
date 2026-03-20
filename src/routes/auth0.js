import express from "express";
import passport from "../config/passport.js";
import { signToken } from "../utils/jwt.js";

const router = express.Router();

// Step 1: React Native opens this URL in a browser/webview
// It redirects user to Auth0 login page
router.get("/login", passport.authenticate("auth0", {
  scope: "openid profile email",
  connection: "google-oauth2",  // forces Google login directly
}));

// Step 2: Auth0 redirects back here after login
router.get("/callback",
  passport.authenticate("auth0", { session: false, failureRedirect: "/" }),
  (req, res) => {
    const token = signToken(req.user);

    // Return JSON — React Native will receive this
    return res.json({
      token,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      }
    });
  }
);

export default router;