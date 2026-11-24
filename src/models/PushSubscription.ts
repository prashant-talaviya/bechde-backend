import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  subscriptionId: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  optedIn: { type: Boolean, default: false },
  platform: { type: String, enum: ['android', 'ios', 'web'], required: true },
}, { timestamps: true });
export default mongoose.model('PushSubscription', schema);
