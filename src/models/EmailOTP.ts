import mongoose, { Schema, Document } from "mongoose";

export interface IEmailOTP extends Document {
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  lastSentAt: Date;
}

const emailOTPSchema = new Schema<IEmailOTP>({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    unique: true
  },

  codeHash: {
    // Save the hash; the readable OTP is sent only by email.
    type: String,
    required: true
  },

  expiresAt: {
    type: Date,
    required: true,
    expires: 0 // MongoDB automatically removes records after expiresAt.
  },

  attempts: {
    type: Number,
    default: 0
  },

  lastSentAt: {
    type: Date,
    required: true
  }
});

export default mongoose.model<IEmailOTP>(
  "EmailOTP",
  emailOTPSchema
);
