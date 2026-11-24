export const ONESIGNAL_APP_ID = 'e7f5b065-7a1e-4479-b8e3-c233d1ae4cc0';
export const oneSignalConfigured = () => !!process.env.ONESIGNAL_REST_API_KEY;

export async function sendPushNotification(input: { title: string; body: string; screen: string; externalIds: string[]; idempotencyKey: string; data?: Record<string, string> }) {
  const key = process.env.ONESIGNAL_REST_API_KEY;
  if (!key) throw new Error('Set ONESIGNAL_REST_API_KEY on the backend before sending notifications.');
  if (!input.externalIds.length || input.externalIds.length > 2000) throw new Error('Invalid notification batch.');
  const response = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ app_id: process.env.ONESIGNAL_APP_ID || ONESIGNAL_APP_ID, target_channel: 'push', include_aliases: { external_id: input.externalIds }, headings: { en: input.title }, contents: { en: input.body }, data: input.data || { screen: input.screen, type: 'promotion' }, idempotency_key: input.idempotencyKey }),
  });
  const result = await response.json() as { id?: string; errors?: unknown };
  if (!response.ok) throw new Error(`OneSignal rejected this batch (HTTP ${response.status}). Check credentials and platform setup, then retry.`);
  if (!result.id) throw new Error('OneSignal found no reachable subscribers in this batch. Check device permissions and subscription setup.');
  return result.id;
}
export const sendPromotionalPush = sendPushNotification;
