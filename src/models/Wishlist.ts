import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
}, { timestamps: true });
schema.index({ userId: 1, listingId: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1, _id: -1 });
export default mongoose.model('Wishlist', schema);
