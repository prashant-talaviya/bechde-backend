import crypto from "crypto";
import jwt from "jsonwebtoken";

export const generateOTP = (): string => {
  // Generate a 4-digit OTP
  return crypto.randomInt(1000, 10000).toString();
};

export const hashOTP = (otp: string): string => {
  // The server secret makes the stored hash harder to guess from database data.
  const secret = process.env.OTP_SECRET;

  if (!secret) {
    throw new Error("OTP_SECRET is missing");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(otp)
    .digest("hex");
};

export const createToken = (
  payload: object,
  expiresIn: "15m" | "7d"
): string => {
  // Sign a temporary registration token (15m) or a login token (7d).
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is missing");
  }

  return jwt.sign(payload, secret, { expiresIn });
};
