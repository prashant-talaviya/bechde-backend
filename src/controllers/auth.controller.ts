
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

import User, { IUser } from "../models/User";
import EmailOTP from "../models/EmailOTP";
import { bindPushSubscription, pushPayloadSchema } from '../services/push-subscriptions';

import {
  generateOTP,
  hashOTP,
  createToken
} from "../utils/auth";

import { sendOTPEmail } from "../services/email.service";

// Use .env settings, or these defaults when a setting is missing.
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRES_MINUTES || 5);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// STEP 1: Request email OTP
export const requestEmailOTP = async (
  req: Request,
  res: Response
) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address"
      });
    }

    // Prevent repeated clicks from sending too many emails.
    const existingOTP = await EmailOTP.findOne({ email });

    if (existingOTP) {
      const elapsed =
        (Date.now() - existingOTP.lastSentAt.getTime()) / 1000;

      if (elapsed < OTP_RESEND_SECONDS) {
        return res.status(429).json({
          success: false,
          message: "Please wait before requesting another OTP",
          retryAfter: Math.ceil(OTP_RESEND_SECONDS - elapsed)
        });
      }
    }

    // Do not create a User record before registration is completed.
    const otp = generateOTP();

    // Replace the previous OTP. Store its hash, never the readable code.
    await EmailOTP.findOneAndUpdate(
      { email },
      {
        $set: {
          codeHash: hashOTP(otp),
          expiresAt: new Date(
            Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
          ),
          attempts: 0,
          lastSentAt: new Date()
        }
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true
      }
    );

    try {
      await sendOTPEmail(email, otp);
    } catch (emailError) {
      // A code that was not delivered should not block the next request.
      await EmailOTP.deleteOne({ email });

      console.error("OTP email delivery failed:", emailError);

      return res.status(500).json({
        success: false,
        message: "Unable to send OTP. Please try again."
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      expiresIn: OTP_EXPIRY_MINUTES * 60
    });

  } catch (error) {
    console.error("Request OTP error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
};


// Email OTP and Google use the same registration and access-token rules.
async function finishAuthentication(email: string, push: ReturnType<typeof pushPayloadSchema.parse>, res: Response, googleId?: string, knownUser?: IUser | null) {
    const user = knownUser || await User.findOne({ email });

    // Existing account
    if (user) {
      if (user.accountStatus !== "active") {
        return res.status(403).json({
          success: false,
          message: "Your account is currently unavailable."
        });
      }

      // Incomplete profile: continue registration.
      if (!user.name || !user.mobile) {
        const registrationToken = createToken(
          {
            email,
            purpose: "registration",
            ...(googleId ? { googleId } : {})
          },
          "15m"
        );

        return res.status(200).json({
          success: true,
          isNewUser: true,
          message: "Complete your profile to continue.",
          registrationToken
        });
      }

      // Completed profile: login.
      await bindPushSubscription(user._id.toString(), push);
      if (push.onesignal_subscription_id) user.onesignal_subscription_id = push.onesignal_subscription_id;
      const token = createToken(
        {
          userId: user._id.toString(),
          purpose: "access"
        },
        "7d"
      );

      return res.status(200).json({
        success: true,
        isNewUser: false,
        message: "Login successful",
        token,
        user
      });
    }

    // New email: issue temporary registration token.
    const registrationToken = createToken(
      {
        email,
        purpose: "registration",
            ...(googleId ? { googleId } : {})
      },
      "15m"
    );

    return res.status(200).json({
      success: true,
      isNewUser: true,
      message: "Email verified. Complete your profile.",
      registrationToken
    });

}

const googleClient = new OAuth2Client();
export const verifyGoogle = async (req: Request, res: Response) => {
  const audience = process.env.GOOGLE_WEB_CLIENT_ID?.trim();
  if (!audience) return res.status(503).json({ success: false, message: 'Google sign-in is not configured on the server.' });
  const push = pushPayloadSchema.safeParse(req.body);
  if (!push.success || typeof req.body.idToken !== 'string' || !req.body.idToken || req.body.idToken.length > 10000) {
    return res.status(400).json({ success: false, message: 'Invalid Google sign-in request.' });
  }
  let identity;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.idToken, audience });
    identity = ticket.getPayload();
  } catch {
    return res.status(401).json({ success: false, message: 'Google verification failed. Please try again.' });
  }
  if (!identity?.sub || !identity.email || !identity.email_verified) {
    return res.status(401).json({ success: false, message: 'Google has not verified this email address.' });
  }
  try {
    const linked = await User.findOne({ googleId: identity.sub });
    const email = linked?.email || identity.email.trim().toLowerCase();
    // Third-party mailboxes must prove current ownership using the existing OTP flow.
    if (!linked && !identity.email.toLowerCase().endsWith('@gmail.com') && !identity.hd) {
      return res.status(403).json({ success: false, message: 'Please use Continue with Email to verify this email address.' });
    }
    const user = linked || await User.findOne({ email });
    if (user) {
      if (user.accountStatus !== 'active') return res.status(403).json({ success: false, message: 'Your account is currently unavailable.' });
      if (user.googleId && user.googleId !== identity.sub) return res.status(409).json({ success: false, message: 'Please use Continue with Email for this account.' });
      const updated = await User.updateOne({ _id: user._id, $or: [{ googleId: { $exists: false } }, { googleId: identity.sub }] }, {
        $set: { googleId: identity.sub, emailVerified: true }, $addToSet: { authProvider: 'google' },
      });
      if (!updated.matchedCount) return res.status(409).json({ success: false, message: 'Account changed. Please sign in again.' });
    }
    return await finishAuthentication(email, push.data, res, identity.sub, user);
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to sign in. Please try again.' });
  }
};

// STEP 2: Verify email OTP
export const verifyEmailOTP = async (
  req: Request,
  res: Response
) => {
  try {
    const push = pushPayloadSchema.safeParse(req.body);
    if (!push.success) return res.status(400).json({ success: false, message: 'Invalid notification subscription.' });
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const otp = String(req.body.otp || "").trim();

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address"
      });
    }

    if (!/^\d{4}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 4-digit OTP"
      });
    }

    const otpRecord = await EmailOTP.findOne({ email });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found. Request a new OTP."
      });
    }

    // Check expiry here because MongoDB may delete expired records later.
    if (otpRecord.expiresAt.getTime() <= Date.now()) {
      await EmailOTP.deleteOne({ email });

      return res.status(400).json({
        success: false,
        message: "OTP expired. Request a new OTP."
      });
    }

    if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      await EmailOTP.deleteOne({ email });

      return res.status(429).json({
        success: false,
        message: "Too many incorrect attempts. Request a new OTP."
      });
    }

    // Compare hashes using a constant-time check to avoid leaking code matches.
    const submittedHash = Buffer.from(hashOTP(otp), "hex");
    const storedHash = Buffer.from(otpRecord.codeHash, "hex");

    const isValid =
      submittedHash.length === storedHash.length &&
      crypto.timingSafeEqual(submittedHash, storedHash);

    if (!isValid) {
      otpRecord.attempts += 1;
      await otpRecord.save();

      return res.status(400).json({
        success: false,
        message: "Incorrect OTP",
        attemptsRemaining: OTP_MAX_ATTEMPTS - otpRecord.attempts
      });
    }

    // Consume OTP after successful verification.
    await EmailOTP.deleteOne({ email });

    return await finishAuthentication(email, push.data, res);

  } catch (error) {
    console.error("Verify OTP error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
};


// STEP 3: Complete registration
export const completeRegistration = async (
  req: Request,
  res: Response
) => {
  try {
    const push = pushPayloadSchema.safeParse(req.body);
    if (!push.success) return res.status(400).json({ success: false, message: 'Invalid notification subscription.' });
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Registration token required"
      });
    }

    // This temporary token proves the email passed OTP verification.
    const registrationToken = authHeader.split(" ")[1];

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing");
    }

    let decoded: string | jwt.JwtPayload;

    try {
      decoded = jwt.verify(
        registrationToken,
        process.env.JWT_SECRET
      );
    } catch {
      return res.status(401).json({
        success: false,
        message: "Registration session expired. Please verify your email again."
      });
    }

    if (
      typeof decoded === "string" ||
      decoded.purpose !== "registration" ||
      typeof decoded.email !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid registration session"
      });
    }

    const email = decoded.email.trim().toLowerCase();

    if (req.body.agreedToPolicies !== true) {
      return res.status(400).json({
        success: false,
        message: "Agree to the Terms and Privacy Policy before registering."
      });
    }

    // Clean incoming profile values before validating and saving them.
    const cleanName = String(req.body.name || "").trim();
    const cleanMobile = String(req.body.mobile || "").trim();

    const gender = req.body.gender
      ? (String(req.body.gender) as IUser["gender"])
      : undefined;

    const cleanProfilePhoto = req.body.profilePhoto
      ? String(req.body.profilePhoto).trim()
      : null;

    const preferredLanguage = String(
      req.body.preferredLanguage || "en"
    ).trim();

    const cleanAddress = {
      area: String(req.body.address?.area || "").trim(),
      city: String(req.body.address?.city || "").trim(),
      state: String(req.body.address?.state || "").trim(),
      pincode: String(req.body.address?.pincode || "").trim(),
      latitude: req.body.address?.latitude,
      longitude: req.body.address?.longitude
    };

    if (cleanAddress.latitude !== undefined || cleanAddress.longitude !== undefined) {
      if (typeof cleanAddress.latitude !== "number" || !Number.isFinite(cleanAddress.latitude) ||
          Math.abs(cleanAddress.latitude) > 90 || typeof cleanAddress.longitude !== "number" ||
          !Number.isFinite(cleanAddress.longitude) || Math.abs(cleanAddress.longitude) > 180) {
        return res.status(400).json({ success: false, message: "Select a valid location on the map." });
      }
    }

    // Validate name.
    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid full name"
      });
    }

    // Validate Indian mobile number.
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit Indian mobile number"
      });
    }

    // Validate gender.
    const allowedGenders = [
      "male",
      "female",
      "other",
      "prefer_not_to_say"
    ];

    if (gender && !allowedGenders.includes(gender)) {
      return res.status(400).json({
        success: false,
        message: "Invalid gender selection"
      });
    }

    // Validate profile photo URL.
    if (cleanProfilePhoto) {
      try {
        const photoURL = new URL(cleanProfilePhoto);

        if (
          photoURL.protocol !== "https:" ||
          cleanProfilePhoto.length > 2048
        ) {
          throw new Error("Invalid photo URL");
        }
      } catch {
        return res.status(400).json({
          success: false,
          message: "Enter a valid HTTPS profile photo URL"
        });
      }
    }

    // Validate preferred language code.
    if (!/^[a-z]{2,10}(-[A-Z]{2})?$/.test(preferredLanguage)) {
      return res.status(400).json({
        success: false,
        message: "Invalid preferred language"
      });
    }

    // Find existing account by verified email.
    const existingUser = await User.findOne({ email });

    if (
      existingUser &&
      existingUser.accountStatus !== "active"
    ) {
      return res.status(403).json({
        success: false,
        message: "Your account is currently unavailable."
      });
    }

    // Check if another account already uses this mobile.
    const mobileUser = await User.findOne({
      mobile: cleanMobile,
      email: { $ne: email }
    });

    if (mobileUser) {
      return res.status(409).json({
        success: false,
        message: "This mobile number is already registered."
      });
    }

    // Both new and incomplete accounts use the same profile fields.
    const profileData = {
      name: cleanName,
      mobile: cleanMobile,
      gender,
      profilePhoto: cleanProfilePhoto,
      preferredLanguage,
      address: cleanAddress,
      emailVerified: true,
      ...(typeof decoded.googleId === "string" ? { googleId: decoded.googleId } : {})
    };

    let user;

    if (existingUser) {
      // Do not overwrite an already completed account.
      if (existingUser.name && existingUser.mobile) {
        return res.status(409).json({
          success: false,
          message: "This account is already registered. Please log in."
        });
      }

      // Update an old incomplete account.
      user = await User.findOneAndUpdate(
        { _id: existingUser._id },
        {
          $set: profileData,
          // Add email login without duplicating the provider in the array.
          $addToSet: {
            authProvider: typeof decoded.googleId === "string" ? "google" : "email"
          }
        },
        {
          returnDocument: "after",
          runValidators: true
        }
      );

    } else {
      // Create a new account.
      user = await User.create({
        ...profileData,
        email,
        authProvider: typeof decoded.googleId === "string" ? ["email", "google"] : ["email"],
        role: "user",
        accountStatus: "active"
      });
    }

    if (!user) {
      throw new Error("Unable to create or update user");
    }

    // Issue access token.
    await bindPushSubscription(user._id.toString(), push.data);
    if (push.data.onesignal_subscription_id) user.onesignal_subscription_id = push.data.onesignal_subscription_id;
    const token = createToken(
      {
        userId: user._id.toString(),
        purpose: "access"
      },
      "7d"
    );

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user
    });

  } catch (error: any) {
    // The unique indexes also catch simultaneous registrations with the same details.
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email or mobile number is already registered."
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to complete registration"
    });
  }
};

// Sign a direct camera upload without exposing the Cloudinary API secret.
export const signProfilePhotoUpload = async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;
  try {
    const decoded = jwt.verify(token || "", process.env.JWT_SECRET || "");
    if (typeof decoded === "string" || decoded.purpose !== "registration" || typeof decoded.email !== "string") {
      return res.status(401).json({ success: false, message: "Please verify your email again." });
    }
  } catch {
    return res.status(401).json({ success: false, message: "Registration session expired. Please verify your email again." });
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !secret) {
    return res.status(503).json({ success: false, message: "Photo uploads are temporarily unavailable." });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `bechde/profiles/${crypto.randomUUID()}`;
  const signature = crypto.createHash("sha1")
    .update(`public_id=${publicId}&timestamp=${timestamp}${secret}`).digest("hex");
  return res.json({ success: true, cloudName, apiKey, timestamp, publicId, signature });
};
