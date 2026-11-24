import mongoose, { Schema } from 'mongoose';
import { notificationIntentSchema } from './notification-intent';
const schema = new Schema({
  kind: { type: String, enum: ['listing', 'need'], required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  title: { type: String, required: true },
  initiatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
  importantBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  buyerInterestNotificationQueued: { type: Boolean, default: false },
  pendingInterestNotification: { type: notificationIntentSchema, default: undefined },
  lastMessage: { type: String, default: '', maxlength: 2000 },
  lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ kind: 1, targetId: 1, initiatorId: 1 }, { unique: true });
schema.index({ participants: 1, lastMessageAt: -1, _id: -1 });
export default mongoose.model('Conversation', schema);
