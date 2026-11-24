import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import Listing from '../models/Listing';
import Need from '../models/Need';
import User from '../models/User';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import { duplicateKey, HttpError, objectId, pageNumber, text } from '../utils/http';
import { notifyUnreadChanged } from '../services/chat-events';
import { buyerInterestNotification } from '../models/notification-intent';

export async function contactTarget(kind: string, targetId: string) {
  if (kind === 'listing') {
    const listing = await Listing.findOne({ _id: targetId, status: 'approved' }).select('_id sellerId title price coverImage categoryId subcategoryId').lean();
    if (!listing || !await Category.exists({ _id: listing.categoryId, isActive: true }) || !await Subcategory.exists({ _id: listing.subcategoryId, isActive: true })) throw new HttpError(404, 'This listing is no longer available.');
    return { ownerId: listing.sellerId.toString(), title: listing.title, listing: { _id: listing._id, title: listing.title, price: listing.price, coverImage: listing.coverImage ?? null } };
  }
  if (kind === 'need') {
    const need = await Need.findOne({ _id: targetId, status: 'approved', isOpen: true }).lean();
    if (!need) throw new HttpError(404, 'This need is closed or unavailable.');
    return { ownerId: need.userId.toString(), title: need.title };
  }
  throw new HttpError(400, 'Choose a listing or need.');
}

export async function startConversation(req: AuthRequest, res: Response) {
  const targetId = objectId(req.body.targetId);
  const kind = req.body.kind;
  const target = await contactTarget(kind, targetId);
  if (target.ownerId === req.userId) throw new HttpError(400, 'You cannot contact yourself.');
  if (!await User.exists({ _id: target.ownerId, accountStatus: 'active' })) throw new HttpError(404, 'This account is unavailable.');
  const filter = { kind, targetId, initiatorId: req.userId };
  let data;
  try {
    data = await Conversation.findOneAndUpdate(filter, { $setOnInsert: { ...filter, ownerId: target.ownerId, title: target.title, participants: [req.userId, target.ownerId] } }, { upsert: true, new: true, runValidators: true });
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    data = await Conversation.findOne(filter);
  }
  return res.json({ success: true, data });
}

export async function listConversations(req: AuthRequest, res: Response) {
  const page = pageNumber(req.query.page);
  const filter: mongoose.QueryFilter<InstanceType<typeof Conversation>> = { participants: req.userId };
  const selected = req.query.filter || 'all';
  if (!['all', 'unread', 'important', 'buying', 'selling'].includes(String(selected))) throw new HttpError(400, 'Choose a valid chat filter.');
  if (selected === 'buying') filter.initiatorId = req.userId;
  if (selected === 'selling') filter.ownerId = req.userId;
  if (selected === 'important') filter.importantBy = req.userId;
  if (selected === 'unread') {
    const conversations = await Conversation.find({ participants: req.userId }).select('_id').lean();
    const unread = await Message.distinct('conversationId', { conversationId: { $in: conversations.map(chat => chat._id) }, senderId: { $ne: req.userId }, readAt: null });
    filter._id = { $in: unread };
  }
  const [data, total] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).populate('participants', 'name profilePhoto accountStatus').lean(),
    Conversation.countDocuments(filter),
  ]);
  const listings = await Listing.find({ _id: { $in: data.filter(chat => chat.kind === 'listing').map(chat => chat.targetId) } }).select('_id coverImage').lean();
  const photos = new Map(listings.map(item => [String(item._id), item.coverImage || null]));
  const rows = data.map(({ importantBy, pendingInterestNotification, buyerInterestNotificationQueued, ...chat }) => ({ ...chat, important: importantBy?.some(id => String(id) === req.userId) || false, coverImage: photos.get(String(chat.targetId)) || null }));
  return res.json({ success: true, data: rows, total, page, pages: Math.ceil(total / 20) });
}

export async function setConversationImportant(req: AuthRequest, res: Response) {
  if (typeof req.body.important !== 'boolean') throw new HttpError(400, 'Choose whether this chat is important.');
  const id = objectId(req.params.conversationId);
  const userId = new mongoose.Types.ObjectId(req.userId);
  const data = await Conversation.findOneAndUpdate({ _id: id, participants: req.userId }, req.body.important ? { $addToSet: { importantBy: userId } } : { $pull: { importantBy: userId } }, { new: true }).select('_id');
  if (!data) throw new HttpError(404, 'Conversation not found.');
  return res.json({ success: true, important: req.body.important });
}

export async function unreadConversations(req: AuthRequest, res: Response) {
  const userId = new mongoose.Types.ObjectId(req.userId);
  const rows = await Conversation.aggregate([
    { $match: { participants: userId } }, { $project: { _id: 1 } },
    { $lookup: { from: Message.collection.name, localField: '_id', foreignField: 'conversationId', pipeline: [{ $match: { senderId: { $ne: userId }, readAt: null } }, { $limit: 1 }, { $project: { _id: 1 } }], as: 'unread' } },
    { $match: { 'unread.0': { $exists: true } } }, { $project: { _id: 1 } },
  ]);
  return res.json({ success: true, data: rows.map(row => String(row._id)) });
}

export async function memberConversation(conversationId: unknown, userId?: string) {
  const id = objectId(conversationId);
  const conversation = await Conversation.findOne({ _id: id, participants: userId }).lean();
  if (!conversation) throw new HttpError(404, 'Conversation not found.');
  return conversation;
}

export async function listMessages(req: AuthRequest, res: Response) {
  const conversation = await memberConversation(req.params.conversationId, req.userId);
  const before = req.query.before ? objectId(req.query.before) : undefined;
  const after = req.query.after ? objectId(req.query.after) : undefined;
  if (before && after) throw new HttpError(400, 'Use either before or after, not both.');
  const filter = { conversationId: conversation._id, ...((before || after) ? { _id: after ? { $gt: after } : { $lt: before } } : {}) };
  const [rows, latestOffer] = await Promise.all([
    Message.find(filter).sort({ _id: after ? 1 : -1 }).limit(51).lean(),
    Message.findOne({ conversationId: conversation._id, kind: 'offer' }).sort({ _id: -1 }).select('_id senderId kind offerAmount text createdAt clientId').lean(),
  ]);
  const hasMore = rows.length > 50;
  const data = rows.slice(0, 50);
  if (!after) data.reverse();
  const participants = await User.find({ _id: { $in: conversation.participants } }).select('name profilePhoto accountStatus').lean();
  let writable = participants.length === 2 && participants.every(user => user.accountStatus === 'active');
  let listing: { _id: mongoose.Types.ObjectId; title: string; price: number; coverImage: string | null } | null = null;
  try { const target = await contactTarget(conversation.kind, conversation.targetId.toString()); listing = target.listing ?? null; }
  catch (error) { if (error instanceof HttpError && error.status === 404) writable = false; else throw error; }
  // Only acknowledge incoming messages included in this response, so a concurrent
  // arrival or an unloaded page remains unread.
  const read = await Message.updateMany({ _id: { $in: data.map(message => message._id) }, senderId: { $ne: req.userId }, readAt: null }, { $set: { readAt: new Date() } });
  if (read?.modifiedCount) notifyUnreadChanged(req.userId!);
  const canOffer = writable && conversation.kind === 'listing' && conversation.initiatorId?.toString() === req.userId;
  const { importantBy, pendingInterestNotification, buyerInterestNotificationQueued, ...publicConversation } = conversation;
  return res.json({ success: true, data, hasMore, conversation: { ...publicConversation, participants }, writable, listing, latestOffer, canOffer });
}

export async function sendMessage(req: AuthRequest, res: Response) {
  const kind = req.body.kind ?? 'text';
  if (kind !== 'text' && kind !== 'offer') throw new HttpError(400, 'Choose a message or offer.');
  let offerAmount: number | undefined;
  if (kind === 'offer') {
    const amount = req.body.offerAmount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1000000000000 || amount !== Number(amount.toFixed(2))) throw new HttpError(400, 'Enter a valid offer amount with up to two decimal places.');
    offerAmount = amount;
  }
  const message = kind === 'offer' ? `Offer: INR ${offerAmount!.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : text(req.body.text, 'Message', 2000);
  const clientId = text(req.body.clientId, 'Message reference', 100);
  const conversation = await memberConversation(req.params.conversationId, req.userId);
  if (kind === 'offer' && (conversation.kind !== 'listing' || conversation.initiatorId?.toString() !== req.userId)) throw new HttpError(403, 'Only the buyer can make an offer on this listing.');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) throw new HttpError(400, 'Invalid message reference.');
  const target = await contactTarget(conversation.kind, conversation.targetId.toString());
  const otherId = conversation.participants.find(id => id.toString() !== req.userId);
  if (!otherId || !await User.exists({ _id: otherId, accountStatus: 'active' })) throw new HttpError(409, 'This account is unavailable.');
  const filter = { conversationId: conversation._id, senderId: req.userId, clientId };
  let data;
  try { data = await Message.findOneAndUpdate(filter, { $setOnInsert: { ...filter, text: message, kind, ...(offerAmount !== undefined ? { offerAmount } : {}) } }, { upsert: true, new: true, runValidators: true }); }
  catch (error) { if (!duplicateKey(error)) throw error; data = await Message.findOne(filter); }
  if (!data) throw new HttpError(409, 'Unable to send. Please retry.');
  if (conversation.kind === 'listing' && String(conversation.initiatorId) === req.userId && !conversation.buyerInterestNotificationQueued) {
    const first = await Message.findOne({ conversationId: conversation._id, senderId: req.userId }).sort({ _id: 1 }).select('_id').lean();
    if (first && String(first._id) === String(data._id)) {
      const notification = buyerInterestNotification({ conversationId: String(conversation._id), listingId: String(conversation.targetId), buyerId: req.userId!, sellerId: String(conversation.ownerId), title: target.title, offer: data.kind === 'offer' });
      // Persist the intent before acknowledging the message; retries cannot replace it.
      await Conversation.updateOne({ _id: conversation._id, buyerInterestNotificationQueued: { $ne: true }, pendingInterestNotification: { $exists: false } }, { $set: { pendingInterestNotification: notification } });
    }
  }
  // An idempotent retry must not replace a newer inbox preview.
  await Conversation.updateOne({ _id: conversation._id, lastMessageAt: { $lte: data.createdAt } }, { $set: { lastMessage: data.text, lastMessageAt: data.createdAt } });
  notifyUnreadChanged(String(otherId));
  return res.status(201).json({ success: true, data });
}
