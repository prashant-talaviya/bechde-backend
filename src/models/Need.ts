import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, required: true, maxlength: 120 },
  description: { type: String, trim: true, required: true, maxlength: 3000 },
  location: { type: String, trim: true, required: true, maxlength: 250 },
  budget: { type: Number, min: 0, default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  isOpen: { type: Boolean, default: true },
  reviewReason: { type: String, maxlength: 1000, default: '' },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ status: 1, isOpen: 1, createdAt: -1, _id: -1 });
schema.index({ userId: 1, createdAt: -1, _id: -1 });
export default mongoose.model('Need', schema);
