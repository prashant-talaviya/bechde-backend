import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Wishlist from '../models/Wishlist';
import Listing from '../models/Listing';
import User from '../models/User';
import { duplicateKey, HttpError, objectId, pageNumber } from '../utils/http';

export async function listWishlist(req: AuthRequest, res: Response) {
  const page = pageNumber(req.query.page);
  const filter = { userId: req.userId };
  const [rows, total] = await Promise.all([
    Wishlist.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20)
      .populate({ path: 'listingId', select: 'title price location coverImage status sellerId', populate: { path: 'sellerId', select: 'accountStatus' } }).lean(),
    Wishlist.countDocuments(filter),
  ]);
  const data = rows.map(row => {
    const listing = row.listingId as unknown as { _id: unknown; title: string; price: number; location: string; coverImage: string | null; status: string; sellerId?: { accountStatus: string } } | null;
    const available = listing?.status === 'approved' && listing.sellerId?.accountStatus === 'active';
    return { _id: row._id, listingId: listing?._id || null, available: !!available,
      item: listing ? { _id: listing._id, title: listing.title, price: listing.price, location: listing.location, coverImage: listing.coverImage } : null };
  });
  return res.json({ success: true, data, total, page, pages: Math.ceil(total / 20) });
}

export async function saveWishlist(req: AuthRequest, res: Response) {
  const listingId = objectId(req.params.listingId);
  const listing = await Listing.findOne({ _id: listingId, status: 'approved' }).lean();
  if (!listing || !await User.exists({ _id: listing.sellerId, accountStatus: 'active' })) throw new HttpError(404, 'This listing is no longer available.');
  try { await Wishlist.updateOne({ userId: req.userId, listingId }, { $setOnInsert: { userId: req.userId, listingId } }, { upsert: true }); }
  catch (error) { if (!duplicateKey(error)) throw error; }
  return res.json({ success: true, message: 'Saved to wishlist.' });
}

export async function removeWishlist(req: AuthRequest, res: Response) {
  const id = objectId(req.params.entryId);
  await Wishlist.deleteOne({ _id: id, userId: req.userId });
  return res.json({ success: true, message: 'Removed from wishlist.' });
}

export async function wishlistState(req: AuthRequest, res: Response) {
  const listingId = objectId(req.params.listingId);
  const entry = await Wishlist.findOne({ userId: req.userId, listingId }).select('_id').lean();
  return res.json({ success: true, data: { saved: !!entry, entryId: entry?._id || null } });
}

export async function wishlistStates(req: AuthRequest, res: Response) {
  if (typeof req.query.ids !== 'string') throw new HttpError(400, 'Listing IDs are required.');
  const values = req.query.ids.split(',');
  if (!values.length || values.length > 24) throw new HttpError(400, 'Request up to 24 listings at a time.');
  const ids = [...new Set(values.map(objectId))];
  const entries = await Wishlist.find({ userId: req.userId, listingId: { $in: ids } }).select('_id listingId').lean();
  const saved = new Map(entries.map(entry => [String(entry.listingId), String(entry._id)]));
  return res.json({ success: true, data: Object.fromEntries(ids.map(id => [id, { saved: saved.has(id), entryId: saved.get(id) || null }])) });
}

export async function adminWishlists(req: AuthRequest, res: Response) {
  const page = pageNumber(req.query.page);
  const filter = req.query.userId ? { userId: objectId(req.query.userId) } : {};
  const [data, total] = await Promise.all([
    Wishlist.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20)
      .populate('userId', 'name email mobile accountStatus')
      .populate('listingId', 'title price location coverImage status sellerId').lean(),
    Wishlist.countDocuments(filter),
  ]);
  return res.json({ success: true, data, total, page, pages: Math.ceil(total / 20) });
}
