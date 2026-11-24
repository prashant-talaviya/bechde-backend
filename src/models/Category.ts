
import mongoose, { Schema, Document } from "mongoose";

export interface ICategory extends Document {
  name: string;
  slug: string;
  icon: string;
  description?: string;
  image?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    icon: {
      type: String,
      required: true,
      default: "grid"
    },

    description: {
      type: String,
      trim: true,
      maxlength: 300
    },

    image: {
      type: String,
      default: null
    },

    sortOrder: {
      type: Number,
      default: 0
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

categorySchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model<ICategory>(
  "Category",
  categorySchema
);
