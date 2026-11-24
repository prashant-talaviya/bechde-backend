import { Schema, model } from 'mongoose';

const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  fromSupport: { type: Boolean, required: true },
  text: { type: String, required: true, maxlength: 2000 },
  clientId: { type: String, required: true, maxlength: 100 },
  readAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ userId: 1, _id: -1 });
schema.index({ userId: 1, senderId: 1, clientId: 1 }, { unique: true });
export default model('SupportMessage', schema);
