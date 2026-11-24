import { Schema, model } from 'mongoose';

const schema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  kind: { type: String, enum: ['image', 'video'], required: true },
  publicId: { type: String, required: true },
  url: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ isActive: 1, sortOrder: 1, _id: 1 });
export default model('Banner', schema);
