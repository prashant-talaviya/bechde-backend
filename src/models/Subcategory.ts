
import mongoose, { Schema, Document } from "mongoose";

export type QuestionType =
  | "text"
  | "number"
  | "select"
  | "radio"
  | "checkbox"
  | "boolean"
  | "year"
  | "date"
  | "range"
  | "textarea"
  | "multi_select";

export interface IQuestion {
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
  suffix?: string;
  helpText?: string;
  sortOrder: number;

  showWhen?: {
    field: string;
    operator: "equals" | "not_equals";
    value: string;
  };
}

export interface ISubcategory extends Document {
  categoryId: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  questionnaire: IQuestion[];
  questionnaireVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuestion>(
  {
    key: {
      type: String,
      required: true,
      trim: true
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    type: {
      type: String,
      required: true,
      enum: [
        "text",
        "number",
        "select",
        "radio",
        "checkbox",
        "boolean",
        "year",
        "date",
        "range",
        "textarea",
        "multi_select"
      ]
    },

    required: {
      type: Boolean,
      default: false
    },

    placeholder: String,

    options: {
      type: [String],
      default: []
    },

    min: Number,
    max: Number,
    suffix: String,
    helpText: String,

    sortOrder: {
      type: Number,
      default: 0
    },

    showWhen: {
      field: String,
      operator: {
        type: String,
        enum: ["equals", "not_equals"]
      },
      value: String
    }
  },
  {
    _id: false
  }
);

const subcategorySchema = new Schema<ISubcategory>(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },

    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },

    description: {
      type: String,
      trim: true
    },

    icon: String,

    sortOrder: {
      type: Number,
      default: 0
    },

    isActive: {
      type: Boolean,
      default: true
    },

    questionnaire: {
      type: [questionSchema],
      default: []
    },
    questionnaireVersion: { type: Number, default: 1 }
  },
  {
    timestamps: true,
    optimisticConcurrency: true
  }
);

subcategorySchema.index(
  { categoryId: 1, slug: 1 },
  { unique: true }
);

subcategorySchema.index({
  categoryId: 1,
  isActive: 1,
  sortOrder: 1
});

export default mongoose.model<ISubcategory>(
  "Subcategory",
  subcategorySchema
);
