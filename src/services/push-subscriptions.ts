import { z } from 'zod';
import PushSubscription from '../models/PushSubscription';
import User from '../models/User';

export const pushPayloadSchema = z.object({
  onesignal_subscription_id: z.uuid().nullable().optional(),
  onesignal_push_opted_in: z.boolean().optional().default(false),
  push_platform: z.enum(['android', 'ios', 'web']).optional().default('android'),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

export async function bindPushSubscription(userId: string, payload: PushPayload) {
  const id = payload.onesignal_subscription_id;
  if (!id) return;
  // A device may change accounts. Its subscription has exactly one current owner.
  await PushSubscription.findOneAndUpdate({ subscriptionId: id }, { $set: { userId, optedIn: payload.onesignal_push_opted_in, platform: payload.push_platform } }, { upsert: true, new: true, runValidators: true });
  await User.updateMany({ _id: { $ne: userId }, onesignal_subscription_id: id }, { $set: { onesignal_subscription_id: null } });
  await User.updateOne({ _id: userId }, { $set: { onesignal_subscription_id: id } });
}
