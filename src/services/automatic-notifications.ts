import Listing from '../models/Listing';
import Conversation from '../models/Conversation';
import NotificationCampaign from '../models/NotificationCampaign';
import EmailNotification from '../models/EmailNotification';
import type { NotificationIntent } from '../models/notification-intent';
import { duplicateKey } from '../utils/http';

export async function enqueueAutomaticNotification(intent: NotificationIntent) {
  try {
    await NotificationCampaign.updateOne({ eventKey: intent.eventKey }, { $setOnInsert: {
      requestId: intent.requestId, eventKey: intent.eventKey, fingerprint: intent.eventKey,
      createdBy: intent.createdBy, title: intent.title, body: intent.body, screen: intent.screen,
      type: intent.type, audience: 'users', recipients: [intent.recipientId], total: 1, batchKeys: [intent.requestId],
      notificationData: { screen: intent.screen, type: intent.type, listingId: intent.listingId, ...(intent.conversationId ? { conversationId: intent.conversationId } : {}) },
    } }, { upsert: true, runValidators: true });
  } catch (e) { if (!duplicateKey(e)) throw e; }
  // Email has its own delivery state; push permissions/provider failures do not affect it.
  try {
    await EmailNotification.updateOne({ eventKey: intent.eventKey }, { $setOnInsert: {
      eventKey: intent.eventKey, requestId: intent.requestId, recipientId: intent.recipientId,
      type: intent.type, subject: intent.title, body: intent.body, screen: intent.screen,
    } }, { upsert: true, runValidators: true });
  } catch (e) { if (!duplicateKey(e)) throw e; }
}

export async function processAutomaticNotificationIntents() {
  // Intents live on the business record until a deduplicated queue entry exists.
  // A crash or provider outage cannot discard a successful moderation/message event.
  const listing = await Listing.findOne({ 'pendingNotifications.0': { $exists: true } }).select('_id pendingNotifications').lean();
  const review = listing?.pendingNotifications?.[0];
  if (listing && review) {
    await enqueueAutomaticNotification(review as NotificationIntent);
    await Listing.updateOne({ _id: listing._id }, { $pull: { pendingNotifications: { eventKey: review.eventKey } } });
  }
  const conversation = await Conversation.findOne({ pendingInterestNotification: { $exists: true }, buyerInterestNotificationQueued: { $ne: true } }).select('_id pendingInterestNotification').lean();
  const interest = conversation?.pendingInterestNotification;
  if (conversation && interest) {
    await enqueueAutomaticNotification(interest as NotificationIntent);
    await Conversation.updateOne({ _id: conversation._id, 'pendingInterestNotification.eventKey': interest.eventKey }, { $set: { buyerInterestNotificationQueued: true }, $unset: { pendingInterestNotification: 1 } });
  }
}
