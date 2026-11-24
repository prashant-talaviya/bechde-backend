import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Feedback from '../models/Feedback';
import { duplicateKey, HttpError, objectId, pageNumber, text } from '../utils/http';

export async function submitFeedback(req: AuthRequest, res: Response) {
  const userId = objectId(req.userId);
  const message = text(req.body?.message, 'Feedback', 2000);
  const clientId = text(req.body?.clientId, 'Submission identifier', 100);
  const rating = req.body?.rating ?? null;
  if (rating !== null && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5)) throw new HttpError(400, 'Choose a rating from 1 to 5.');
  let data;
  try { data = await Feedback.create({ userId, message, rating, clientId }); }
  catch (error) {
    if (!duplicateKey(error)) throw error;
    data = await Feedback.findOne({ userId, clientId });
    if (!data || data.message !== message || (data.rating ?? null) !== rating) throw new HttpError(409, 'Submission identifier already used.');
  }
  return res.json({ success: true, data: { _id: data._id }, message: 'Thank you. Your feedback has been sent to the BechDe team.' });
}
export async function adminFeedback(req: AuthRequest, res: Response) {
  if (req.userRole !== 'admin') throw new HttpError(403, 'Admin access required.');
  const page = pageNumber(req.query.page);
  const [data, total] = await Promise.all([
    Feedback.find().sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20)
      .select('userId message rating createdAt').populate('userId', 'name email').lean(),
    Feedback.countDocuments(),
  ]);
  return res.json({ success: true, data, total, page, pages: Math.ceil(total / 20) });
}
