import mongoose, { Schema } from 'mongoose';
import { automaticNotificationTypes } from './notification-intent';

const schema = new Schema({
  eventKey: { type: String, required: true, unique: true },
  requestId: { type: String, required: true },
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: automaticNotificationTypes, required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  screen: { type: String, enum: ['my-ads', 'chat'], required: true },
  status: { type: String, enum: ['queued', 'sending', 'sent', 'failed', 'skipped'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: { type: Date, default: null },
  leaseToken: String,
  sentAt: Date,
  error: { type: String, default: '' },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1 });
export default mongoose.model('EmailNotification', schema);
