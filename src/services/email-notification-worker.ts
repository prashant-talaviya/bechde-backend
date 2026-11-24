import { randomUUID } from 'node:crypto';
import EmailNotification from '../models/EmailNotification';
import User from '../models/User';
import { emailConfigured, sendMarketplaceEmail } from './email.service';

export async function processMarketplaceEmail() {
  if (!emailConfigured()) return;
  const leaseToken = randomUUID();
  const job = await EmailNotification.findOneAndUpdate({ $or: [
    { status: 'queued' },
    { status: 'failed', attempts: { $lt: 5 }, nextAttemptAt: { $lte: new Date() } },
    { status: 'sending', leaseUntil: { $lt: new Date() } },
  ] }, { $set: { status: 'sending', leaseToken, leaseUntil: new Date(Date.now() + 300000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } }).lean();
  if (!job) return;
  const claim = { _id: job._id, leaseToken };
  try {
    const user = await User.findOne({ _id: job.recipientId, accountStatus: 'active', emailVerified: true }).select('name email').lean();
    if (!user?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
      await EmailNotification.updateOne(claim, { $set: { status: 'skipped', leaseUntil: null, error: 'Recipient is unavailable or has no verified email.' } });
      return;
    }
    await sendMarketplaceEmail({ email: user.email, name: user.name || '', subject: job.subject, body: job.body, screen: job.screen, requestId: job.requestId });
    await EmailNotification.updateOne(claim, { $set: { status: 'sent', sentAt: new Date(), leaseUntil: null, error: '' } });
  } catch (e) {
    await EmailNotification.updateOne(claim, { $set: { status: 'failed', leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(job.attempts || 1, 7))),
      error: e instanceof Error ? e.message.slice(0, 400) : 'Email delivery failed.',
    } });
  }
}
