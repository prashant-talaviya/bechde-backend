import Feedback from '../models/Feedback';
import SupportMessage from '../models/SupportMessage';
import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User';
import Listing from '../models/Listing';
import Wishlist from '../models/Wishlist';
import Need from '../models/Need';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import EmailOTP from '../models/EmailOTP';
import PushSubscription from '../models/PushSubscription';
import { HttpError, objectId, pageNumber } from '../utils/http';

export async function userDetails(req: AuthRequest, res: Response) {
  const id = objectId(req.params.userId);
  const page = pageNumber(req.query.page);
  const user = await User.findById(id).select('-__v').lean();
  if (!user) throw new HttpError(404, 'User not found.');
  const [listings, needs, wishlist, listingCount, needCount, wishlistCount, conversations] = await Promise.all([
    Listing.find({ sellerId: id }).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).populate('categoryId', 'name').lean(),
    Need.find({ userId: id }).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
    Wishlist.find({ userId: id }).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).populate('listingId', 'title price location coverImage status').lean(),
    Listing.countDocuments({ sellerId: id }), Need.countDocuments({ userId: id }), Wishlist.countDocuments({ userId: id }), Conversation.countDocuments({ participants: id }),
  ]);
  return res.json({ success: true, data: { user, listings, needs, wishlist, counts: { listings: listingCount, needs: needCount, wishlist: wishlistCount, conversations } }, page, pages: Math.ceil(Math.max(listingCount, needCount, wishlistCount) / 20) });
}

export async function userStatus(req: AuthRequest, res: Response) {
  const id = objectId(req.params.userId);
  if (!['active', 'blocked'].includes(req.body.accountStatus)) throw new HttpError(400, 'Choose active or blocked.');
  if (id === req.userId && req.body.accountStatus !== 'active') throw new HttpError(400, 'You cannot deactivate your own account.');
  const data = await User.findByIdAndUpdate(id, { $set: { accountStatus: req.body.accountStatus } }, { new: true, runValidators: true }).select('name email accountStatus');
  if (!data) throw new HttpError(404, 'User not found.');
  return res.json({ success: true, data });
}

export async function deleteUser(req: AuthRequest, res: Response) {
  const id = objectId(req.params.userId);
  if (id === req.userId) throw new HttpError(400, 'You cannot delete your own admin account.');
  // All records are removed together; this requires a MongoDB replica set (including Atlas).
  await mongoose.connection.transaction(async session => {
    const user = await User.findById(id).session(session);
    if (!user) throw new HttpError(404, 'User not found.');
    if (user.role === 'admin') throw new HttpError(400, 'Remove admin access before deleting this account.');
    if (req.body.confirmEmail !== user.email) throw new HttpError(400, 'Type the user email to confirm permanent deletion.');
    const listings = await Listing.find({ sellerId: id }).select('_id').session(session).lean();
    const conversations = await Conversation.find({ participants: id }).select('_id').session(session).lean();
    await Feedback.deleteMany({ userId: id }, { session });
    await SupportMessage.deleteMany({ userId: id }, { session });
    await Message.deleteMany({ conversationId: { $in: conversations.map(item => item._id) } }, { session });
    await Conversation.deleteMany({ participants: id }, { session });
    await Wishlist.deleteMany({ $or: [{ userId: id }, { listingId: { $in: listings.map(item => item._id) } }] }, { session });
    await Listing.deleteMany({ sellerId: id }, { session });
    await Need.deleteMany({ userId: id }, { session });
    await EmailOTP.deleteMany({ email: user.email }, { session });
    await PushSubscription.deleteMany({ userId: id }, { session });
    await Listing.updateMany({ reviewedBy: id }, { $set: { reviewedBy: null } }, { session });
    await Need.updateMany({ reviewedBy: id }, { $set: { reviewedBy: null } }, { session });
    await User.deleteOne({ _id: id, role: 'user' }, { session });
  });
  return res.json({ success: true, message: 'Account and associated marketplace data deleted.' });
}
