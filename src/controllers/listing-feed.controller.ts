import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import mongoose, { type PipelineStage } from 'mongoose';
import Listing from '../models/Listing';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import User from '../models/User';
import { HttpError, searchText } from '../utils/http';

export function decodeListingCursor(value: unknown): { createdAt: Date; _id: mongoose.Types.ObjectId } | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 256 || !/^[\w-]+$/.test(value)) throw new HttpError(400, 'Invalid listing cursor.');
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const createdAt = new Date(cursor.createdAt);
    if (typeof cursor.createdAt !== 'string' || !Number.isFinite(createdAt.getTime()) || typeof cursor.id !== 'string' || !/^[a-f\d]{24}$/i.test(cursor.id)) throw new Error();
    return { createdAt, _id: new mongoose.Types.ObjectId(cursor.id) };
  } catch { throw new HttpError(400, 'Invalid listing cursor.'); }
}

export async function listPublicListings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const requestedLimit = Number(req.query.limit ?? 12);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw new HttpError(400, 'Invalid listing limit.');
    const limit = Math.min(requestedLimit, 24);
    const cursor = decodeListingCursor(req.query.cursor);
    const query = searchText(req.query.q);
    const filter: Record<string, unknown> = { status: 'approved' };
    if (req.userId) {
      filter.sellerId = { $ne: new mongoose.Types.ObjectId(req.userId) };
      res.set('Cache-Control', 'private, no-store');
    }
    if (req.query.category && req.query.category !== 'All') {
      if (typeof req.query.category !== 'string' || req.query.category.length > 100) throw new HttpError(400, 'Invalid category.');
      const category = await Category.findOne({ slug: req.query.category, isActive: true }).select('_id').lean();
      if (!category) return res.json({ success: true, data: [], hasMore: false, nextCursor: null });
      filter.categoryId = category._id;
    }
    const conditions: Record<string, unknown>[] = [];
    if (query) conditions.push({ $or: [{ title: { $regex: query, $options: 'i' } }, { location: { $regex: query, $options: 'i' } }] });
    if (cursor) conditions.push({ $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }] });
    if (conditions.length) filter.$and = conditions;
    const pipeline: PipelineStage[] = [
      { $match: filter }, { $sort: { createdAt: -1, _id: -1 } },
      // Cards do not need descriptions, galleries or the complete questionnaire answers.
      { $project: { title: 1, price: 1, location: 1, coverImage: 1, createdAt: 1, categoryId: 1, subcategoryId: 1, sellerId: 1, 'attributes.condition': 1 } },
      { $lookup: { from: Category.collection.name, localField: 'categoryId', foreignField: '_id', pipeline: [{ $match: { isActive: true } }, { $project: { name: 1, slug: 1, icon: 1 } }], as: 'categoryId' } },
      { $unwind: '$categoryId' },
      { $lookup: { from: Subcategory.collection.name, localField: 'subcategoryId', foreignField: '_id', pipeline: [{ $match: { isActive: true } }, { $project: { name: 1 } }], as: 'subcategoryId' } },
      { $unwind: '$subcategoryId' },
      { $lookup: { from: User.collection.name, localField: 'sellerId', foreignField: '_id', pipeline: [{ $match: { accountStatus: 'active' } }, { $project: { _id: 1 } }], as: 'seller' } },
      { $match: { 'seller.0': { $exists: true } } },
      // Filter unavailable owners/categories before the limit, so a hidden ad cannot end paging early.
      { $limit: limit + 1 }, { $project: { seller: 0, sellerId: 0 } },
    ];
    const rows = await Listing.aggregate(pipeline);
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: new Date(last.createdAt).toISOString(), id: String(last._id) })).toString('base64url') : null;
    return res.json({ success: true, data, hasMore, nextCursor });
  } catch (error) { next(error); }
}
