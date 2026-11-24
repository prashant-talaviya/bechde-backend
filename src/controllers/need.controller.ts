import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import Need from '../models/Need';
import User from '../models/User';
import { HttpError, objectId, pageNumber, searchText, text } from '../utils/http';

export async function listNeeds(req: AuthRequest, res: Response) {
  const page = pageNumber(req.query.page);
  const mine = req.query.mine === 'true';
  const location = searchText(req.query.location);
  if (!mine) {
    const [result] = await Need.aggregate([
      { $match: { status: 'approved', isOpen: true, ...(location ? { location: { $regex: location, $options: 'i' } } : {}) } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', pipeline: [{ $match: { accountStatus: 'active' } }, { $project: { name: 1, profilePhoto: 1 } }], as: 'userId' } },
      { $unwind: '$userId' },
      { $facet: { data: [{ $skip: (page - 1) * 20 }, { $limit: 20 }, { $project: { reviewReason: 0, reviewedBy: 0, reviewedAt: 0, __v: 0 } }], count: [{ $count: 'total' }] } },
    ]);
    const total = result?.count[0]?.total || 0;
    return res.json({ success: true, data: result?.data || [], total, page, pages: Math.ceil(total / 20) });
  }
  const filter = { userId: req.userId };
  const [data, total] = await Promise.all([
    Need.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20)
      .populate('userId', 'name profilePhoto').select(mine ? '-reviewedBy -__v' : '-reviewReason -reviewedBy -reviewedAt -__v').lean(),
    Need.countDocuments(filter),
  ]);
  return res.json({ success: true, data, total, page, pages: Math.ceil(total / 20) });
}

export async function createNeed(req: AuthRequest, res: Response) {
  const title = text(req.body.title, 'Title', 120);
  const description = text(req.body.description, 'Description', 3000);
  const location = text(req.body.location, 'Location', 250);
  const budget = req.body.budget ?? null;
  if (budget !== null && (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0)) throw new HttpError(400, 'Enter a valid nonnegative budget.');
  const data = await Need.create({ userId: req.userId, title, description, location, budget, status: 'pending', isOpen: true });
  return res.status(201).json({ success: true, data, message: 'Your need has been submitted for admin approval.' });
}

export async function setNeedOpen(req: AuthRequest, res: Response) {
  const id = objectId(req.params.needId);
  if (typeof req.body.isOpen !== 'boolean') throw new HttpError(400, 'Provide an open or closed status.');
  const data = await Need.findOneAndUpdate({ _id: id, userId: req.userId }, { $set: { isOpen: req.body.isOpen } }, { new: true });
  if (!data) throw new HttpError(404, 'Need not found.');
  return res.json({ success: true, data });
}

export async function adminNeeds(req: AuthRequest, res: Response) {
  const page = pageNumber(req.query.page);
  const status = String(req.query.status || 'pending');
  if (!['all', 'pending', 'approved', 'rejected'].includes(status)) throw new HttpError(400, 'Invalid status.');
  const filter: mongoose.QueryFilter<mongoose.InferSchemaType<typeof Need.schema>> = status === 'all' ? {} : { status: status as 'pending' | 'approved' | 'rejected' };
  const [data, total] = await Promise.all([
    Need.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).populate('userId', 'name email mobile accountStatus').lean(),
    Need.countDocuments(filter),
  ]);
  return res.json({ success: true, data, total, page, pages: Math.ceil(total / 20) });
}

export async function reviewNeed(req: AuthRequest, res: Response) {
  const id = objectId(req.params.needId);
  const { status, updatedAt } = req.body;
  if (!['approved', 'rejected'].includes(status)) throw new HttpError(400, 'Choose approved or rejected.');
  const reviewReason = status === 'rejected' ? text(req.body.reviewReason, 'Review feedback', 1000) : '';
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) throw new HttpError(400, 'Reload the need before reviewing.');
  const data = await Need.findOneAndUpdate({ _id: id, updatedAt: new Date(updatedAt) }, { $set: { status, reviewReason, reviewedBy: req.userId, reviewedAt: new Date() } }, { new: true, runValidators: true });
  if (!data) throw new HttpError(409, 'Need changed or was deleted. Refresh before reviewing.');
  return res.json({ success: true, data });
}
