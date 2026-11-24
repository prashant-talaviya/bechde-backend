import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import SupportMessage from '../models/SupportMessage';
import User from '../models/User';
import { duplicateKey, HttpError, objectId, pageNumber, text } from '../utils/http';

// Member endpoints always derive ownership from authentication, never the body.
function owner(req: AuthRequest, admin: boolean) {
  if (admin && req.userRole !== 'admin') throw new HttpError(403, 'Admin access required.');
  return objectId(admin ? req.params.userId : req.userId);
}
async function messages(req: AuthRequest, res: Response, admin: boolean) {
  const userId = owner(req, admin);
  const before = req.query.before ? objectId(req.query.before) : undefined;
  const rows = await SupportMessage.find({ userId, ...(before ? { _id: { $lt: before } } : {}) })
    .sort({ _id: -1 }).limit(41).select('text fromSupport createdAt readAt clientId').lean();
  const data = rows.slice(0, 40).reverse();
  // Only mark incoming messages actually returned to this reader.
  await SupportMessage.updateMany({ _id: { $in: data.map(row => row._id) }, fromSupport: !admin, readAt: null }, { $set: { readAt: new Date() } });
  return res.json({ success: true, data, hasMore: rows.length > 40 });
}
async function send(req: AuthRequest, res: Response, admin: boolean) {
  const userId = owner(req, admin);
  const body = text(req.body?.text, 'Message', 2000);
  const clientId = text(req.body?.clientId, 'Message identifier', 100);
  if (admin && !await User.exists({ _id: userId, accountStatus: 'active' })) throw new HttpError(404, 'Active user not found.');
  const key = { userId, senderId: req.userId, clientId };
  let data;
  try { data = await SupportMessage.create({ ...key, text: body, fromSupport: admin }); }
  catch (error) {
    if (!duplicateKey(error)) throw error;
    data = await SupportMessage.findOne(key);
    if (!data || data.text !== body) throw new HttpError(409, 'Message identifier already used.');
  }
  return res.json({ success: true, data: { _id: data._id, text: data.text, fromSupport: data.fromSupport, createdAt: data.createdAt, clientId: data.clientId } });
}
export const supportMessages = (req: AuthRequest, res: Response) => messages(req, res, false);
export const sendSupportMessage = (req: AuthRequest, res: Response) => send(req, res, false);
export const adminSupportMessages = (req: AuthRequest, res: Response) => messages(req, res, true);
export const adminSendSupportMessage = (req: AuthRequest, res: Response) => send(req, res, true);
export async function supportInbox(req: AuthRequest, res: Response) {
  if (req.userRole !== 'admin') throw new HttpError(403, 'Admin access required.');
  const page = pageNumber(req.query.page);
  const [result] = await SupportMessage.aggregate([
    { $sort: { _id: -1 } },
    { $group: { _id: '$userId', lastMessage: { $first: '$text' }, lastMessageAt: { $first: '$createdAt' }, unread: { $sum: { $cond: [{ $and: [{ $eq: ['$fromSupport', false] }, { $eq: ['$readAt', null] }] }, 1, 0] } } } },
    { $sort: { lastMessageAt: -1, _id: -1 } },
    { $facet: { count: [{ $count: 'total' }], data: [
      { $skip: (page - 1) * 20 }, { $limit: 20 },
      { $lookup: { from: User.collection.name, localField: '_id', foreignField: '_id', pipeline: [{ $project: { name: 1, email: 1, accountStatus: 1 } }], as: 'users' } },
      { $set: { user: { $arrayElemAt: ['$users', 0] } } }, { $unset: 'users' },
    ] } },
  ]);
  const total = result?.count[0]?.total || 0;
  return res.json({ success: true, data: result?.data || [], total, page, pages: Math.ceil(total / 20) });
}
