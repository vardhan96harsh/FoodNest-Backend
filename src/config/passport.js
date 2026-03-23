import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

import passport from "passport";
import { Strategy as Auth0Strategy } from "passport-auth0";
import { User } from "../models/User.js";
import { RegistrationRequest } from "../models/RegistrationRequest.js";

passport.use(new Auth0Strategy({
  domain:      process.env.AUTH0_DOMAIN,
  clientID:    process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  callbackURL: process.env.AUTH0_CALLBACK_URL,
}, async (accessToken, refreshToken, extraParams, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value;
    if (!email) return done(new Error("No email from Auth0"), null);

    // 1. Check if approved user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      // Already approved — log them in normally
      return done(null, { ...existingUser.toObject(), status: "approved" });
    }

    // 2. Check if pending request already exists
    const existingRequest = await RegistrationRequest.findOne({ email });
    if (existingRequest) {
      // Still pending
      return done(null, { 
        status: "pending", 
        email, 
        name: existingRequest.name 
      });
    }

    // 3. New Google user — create pending registration request
    const newRequest = new RegistrationRequest({
      email,
      name: profile.displayName || email,
      role: "rider",
      loginType: "google",
      googleId: profile.id,
      auth0Id: profile.id,
    });
    await newRequest.save();

    return done(null, { 
      status: "pending", 
      email, 
      name: profile.displayName || email 
    });

  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done)   => done(null, user._id || user.email));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id).catch(() => null);
  done(null, user);
});

export default passport;