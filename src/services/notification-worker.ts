import { randomUUID } from 'node:crypto';
import NotificationCampaign from '../models/NotificationCampaign';
import PushSubscription from '../models/PushSubscription';
import User from '../models/User';
import { oneSignalConfigured, sendPushNotification } from './onesignal';
import { processAutomaticNotificationIntents } from './automatic-notifications';
import { automaticNotificationTypes } from '../models/notification-intent';
import { processMarketplaceEmail } from './email-notification-worker';

export async function processNotificationBatch() {
  if (!oneSignalConfigured()) return;
  const leaseToken = randomUUID();
  const campaign = await NotificationCampaign.findOneAndUpdate({ $or: [{ status: 'queued' }, { status: 'sending', leaseUntil: { $lt: new Date() } }, { status: 'failed', type: { $in: automaticNotificationTypes }, attempts: { $lt: 5 }, nextAttemptAt: { $lte: new Date() } }] }, { $set: { status: 'sending', leaseToken, leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } }).lean();
  if (!campaign) return;
  const claim = { _id: campaign._id, leaseToken };
  try {
    if (campaign.createdAt && campaign.createdAt.getTime() < Date.now() - 29 * 86400000) throw new Error('This campaign is too old to retry safely. Create a new campaign if another send is intended.');
    const batch = campaign.recipients.slice(campaign.cursor, campaign.cursor + 2000);
    // Recheck eligibility at dispatch time, including blocked/deleted accounts.
    const subscribed = await PushSubscription.distinct('userId', { userId: { $in: batch }, optedIn: true });
    const users = await User.find({ _id: { $in: subscribed }, accountStatus: 'active' }).select('_id').lean();
    const externalIds = users.map(user => String(user._id));
    let notificationId: string | undefined;
    const data = campaign.notificationData?.screen ? Object.fromEntries(Object.entries(campaign.notificationData).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined;
    if (externalIds.length) notificationId = await sendPushNotification({ title: campaign.title, body: campaign.body, screen: campaign.screen, externalIds, idempotencyKey: campaign.batchKeys[Math.floor(campaign.cursor / 2000)]!, data });
    const cursor = campaign.cursor + batch.length;
    await NotificationCampaign.updateOne(claim, {
      $set: { cursor, status: cursor >= campaign.total ? 'submitted' : 'queued', leaseUntil: null, error: '' },
      $inc: { submitted: externalIds.length },
      ...(notificationId ? { $push: { notificationIds: notificationId } } : {}),
    });
  } catch (e) {
    await NotificationCampaign.updateOne(claim, { $set: { status: 'failed', leaseUntil: null, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(campaign.attempts || 1, 7))), error: e instanceof Error ? e.message.slice(0, 400) : 'Notification send failed. Retry this campaign.' } });
  }
}

export function startNotificationWorker() {
  let running = false;
  let emailRunning = false;
  const emailTick = async () => {
    if (emailRunning) return;
    emailRunning = true;
    try { await processMarketplaceEmail(); } catch { console.error('Email worker could not process a notification.'); }
    finally { emailRunning = false; }
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processAutomaticNotificationIntents(); await processNotificationBatch(); } catch { console.error('Notification worker could not process a campaign.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); void emailTick(); }, 3000);
  timer.unref();
  void tick();
  void emailTick();
  return () => clearInterval(timer);
}
