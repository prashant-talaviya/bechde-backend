import { createHash, randomUUID } from 'node:crypto';
import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import NotificationCampaign from '../models/NotificationCampaign';
import PushSubscription from '../models/PushSubscription';
import User from '../models/User';
import { oneSignalConfigured } from '../services/onesignal';
import { duplicateKey, HttpError, objectId, pageNumber } from '../utils/http';

export const promotionSchema = z.object({
  requestId: z.uuidv4(), title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(500),
  screen: z.enum(['home', 'sell', 'needs']).default('home'), audience: z.enum(['all', 'users']),
  userIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(2000).default([]),
}).strict().refine(value => value.audience !== 'users' || value.userIds.length > 0, { message: 'Choose at least one user.' });

const publicFields = '-recipients -batchKeys -fingerprint -leaseToken -leaseUntil';
export async function listNotificationCampaigns(req: AuthRequest, res: Response) {
  const page = pageNumber(req.query.page);
  const [data, total, subscriberIds] = await Promise.all([
    NotificationCampaign.find().select(publicFields).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
    NotificationCampaign.countDocuments(), PushSubscription.distinct('userId', { optedIn: true }),
  ]);
  const eligibleUsers = await User.countDocuments({ _id: { $in: subscriberIds }, accountStatus: 'active' });
  return res.json({ success: true, data, total, page, pages: Math.ceil(total / 20), configured: oneSignalConfigured(), eligibleUsers });
}

export async function createNotificationCampaign(req: AuthRequest, res: Response) {
  const parsed = promotionSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Provide a title, message, audience, and valid request ID.');
  if (!oneSignalConfigured()) throw new HttpError(503, 'Set ONESIGNAL_REST_API_KEY on the backend before sending notifications.');
  const { requestId, userIds, ...content } = parsed.data;
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...content, userIds: [...new Set(userIds)].sort() })).digest('hex');
  const previous = await NotificationCampaign.findOne({ requestId }).select('fingerprint').lean();
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'This request ID belongs to another notification. Start a new campaign.');
    const data = await NotificationCampaign.findOne({ requestId }).select(publicFields).lean();
    return res.json({ success: true, data });
  }
  const subscribed = await PushSubscription.distinct('userId', { optedIn: true, ...(content.audience === 'users' ? { userId: { $in: userIds } } : {}) });
  const recipients = await User.find({ _id: { $in: subscribed }, accountStatus: 'active' }).select('_id').lean();
  if (!recipients.length) throw new HttpError(400, 'No active users with opted-in push subscriptions match this audience.');
  const record = { requestId, fingerprint, ...content, createdBy: req.userId, recipients: recipients.map(user => user._id), total: recipients.length, batchKeys: Array.from({ length: Math.ceil(recipients.length / 2000) }, () => randomUUID()) };
  try { await NotificationCampaign.create(record); }
  catch (e) {
    if (!duplicateKey(e)) throw e;
    const concurrent = await NotificationCampaign.findOne({ requestId }).select('fingerprint').lean();
    if (concurrent?.fingerprint !== fingerprint) throw new HttpError(409, 'This request ID belongs to another notification.');
  }
  const data = await NotificationCampaign.findOne({ requestId }).select(publicFields).lean();
  return res.status(202).json({ success: true, data });
}

export async function retryNotificationCampaign(req: AuthRequest, res: Response) {
  if (!oneSignalConfigured()) throw new HttpError(503, 'Configure the OneSignal REST API key first.');
  const data = await NotificationCampaign.findOneAndUpdate({ _id: objectId(req.params.campaignId), status: 'failed', createdAt: { $gt: new Date(Date.now() - 29 * 86400000) } }, { $set: { status: 'queued', error: '', attempts: 0, nextAttemptAt: null } }, { new: true }).select(publicFields).lean();
  if (!data) throw new HttpError(409, 'Only failed campaigns from the last 29 days can be retried safely.');
  return res.json({ success: true, data });
}
