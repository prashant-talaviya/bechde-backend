import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  kind: { type: String, enum: ['text', 'offer'], default: 'text' },
  offerAmount: { type: Number, min: 0.01, max: 1000000000000 },
  clientId: { type: String, required: true, maxlength: 100 },
  readAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ conversationId: 1, _id: -1 });
schema.index({ conversationId: 1, kind: 1, _id: -1 });
schema.index({ conversationId: 1, readAt: 1, senderId: 1 });
schema.index({ conversationId: 1, senderId: 1, clientId: 1 }, { unique: true });
export default mongoose.model('Message', schema);
