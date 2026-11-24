import { Schema, model } from 'mongoose';

const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, default: null, validate: { validator: (value: number | null) => value === null || Number.isInteger(value), message: 'Choose a whole-number rating from 1 to 5.' } },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  clientId: { type: String, required: true, maxlength: 100 },
}, { timestamps: true });
schema.index({ userId: 1, clientId: 1 }, { unique: true });
schema.index({ createdAt: -1, _id: -1 });
export default model('Feedback', schema);
