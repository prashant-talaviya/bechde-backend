import mongoose, { Schema } from 'mongoose';
const notificationDataSchema = new Schema({ screen: String, type: String, listingId: String, conversationId: String }, { _id: false });
const schema = new Schema({
  requestId: { type: String, required: true, unique: true },
  eventKey: { type: String },
  type: { type: String, enum: ['promotion', 'listing_approved', 'listing_rejected', 'buyer_interest'], default: 'promotion' },
  notificationData: { type: notificationDataSchema, default: undefined },
  fingerprint: { type: String, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  screen: { type: String, enum: ['home', 'sell', 'needs', 'my-ads', 'chat'], default: 'home' },
  audience: { type: String, enum: ['all', 'users'], required: true },
  recipients: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  batchKeys: [String],
  cursor: { type: Number, default: 0 },
  total: { type: Number, required: true },
  submitted: { type: Number, default: 0 },
  status: { type: String, enum: ['queued', 'sending', 'submitted', 'failed'], default: 'queued', index: true },
  leaseUntil: { type: Date, default: null },
  leaseToken: String,
  notificationIds: [String],
  error: { type: String, default: '' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ eventKey: 1 }, { unique: true, sparse: true });
export default mongoose.model('NotificationCampaign', schema);
