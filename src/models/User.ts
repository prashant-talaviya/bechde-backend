import mongoose, { Schema, Document } from "mongoose";

// TypeScript describes the user fields; the schema below controls database rules.
export interface IUser extends Document {
  name: string;
  email: string;
  mobile: string;
  gender?: "male" | "female" | "other" | "prefer_not_to_say";
  profilePhoto?: string | null;
  preferredLanguage: string;
  onesignal_subscription_id?: string | null;

  address?: {
    area?: string;
    city?: string;
    state?: string;
    pincode?: string;
    latitude?: number;
    longitude?: number;
  };

  googleId?: string;
  authProvider: string[];
  role: "user" | "admin";
  accountStatus: "active" | "blocked";
  emailVerified: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer_not_to_say"],
      default: undefined
    },

    profilePhoto: {
      type: String,
      default: null
    },

    preferredLanguage: {
      type: String,
      default: "en"
    },
    onesignal_subscription_id: { type: String, default: null },

    address: {
      area: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 }
    },

    googleId: { type: String },

    authProvider: {
      type: [String],
      default: ["email"]
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },

    accountStatus: {
      type: String,
      enum: ["active", "blocked"],
      default: "active"
    },

    emailVerified: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true // Mongoose maintains createdAt and updatedAt.
  }
);

userSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });

export default mongoose.model<IUser>("User", userSchema);
