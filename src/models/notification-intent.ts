import { Schema } from 'mongoose';
import { randomUUID } from 'node:crypto';

export const automaticNotificationTypes = ['listing_approved', 'listing_rejected', 'buyer_interest'] as const;
export type NotificationIntent = {
  eventKey: string; requestId: string; createdBy: string; recipientId: string;
  title: string; body: string; screen: 'my-ads' | 'chat';
  type: typeof automaticNotificationTypes[number]; listingId: string; conversationId?: string;
};
export const notificationIntentSchema = new Schema({
  eventKey: { type: String, required: true }, requestId: { type: String, required: true },
  createdBy: { type: String, required: true }, recipientId: { type: String, required: true },
  title: { type: String, required: true }, body: { type: String, required: true },
  screen: { type: String, enum: ['my-ads', 'chat'], required: true },
  type: { type: String, enum: automaticNotificationTypes, required: true },
  listingId: { type: String, required: true }, conversationId: String,
}, { _id: false });

export function listingReviewNotification(input: { listingId: string; sellerId: string; reviewerId: string; title: string; status: 'approved' | 'rejected'; reason: string }): NotificationIntent {
  const requestId = randomUUID();
  return { requestId, eventKey: `listing-review:${input.listingId}:${requestId}`, createdBy: input.reviewerId, recipientId: input.sellerId,
    title: input.status === 'approved' ? 'Your listing is approved!' : 'Your listing was rejected',
    body: (input.status === 'approved' ? `“${input.title}” is now live. Buyers can find your item and contact you.` : `“${input.title}” was rejected. ${input.reason}`).slice(0, 500),
    screen: 'my-ads', type: input.status === 'approved' ? 'listing_approved' : 'listing_rejected', listingId: input.listingId };
}
export function buyerInterestNotification(input: { conversationId: string; listingId: string; buyerId: string; sellerId: string; title: string; offer: boolean }): NotificationIntent {
  return { requestId: randomUUID(), eventKey: `buyer-interest:${input.conversationId}`, createdBy: input.buyerId, recipientId: input.sellerId,
    title: 'A buyer is interested in your item',
    body: (input.offer ? `A buyer has made an offer for “${input.title}”. Start a chat now!` : `A buyer is interested in buying “${input.title}”. Start a chat now!`).slice(0, 500),
    screen: 'chat', type: 'buyer_interest', listingId: input.listingId, conversationId: input.conversationId };
}
