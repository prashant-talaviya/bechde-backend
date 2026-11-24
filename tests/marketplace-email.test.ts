import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import EmailNotification from '../src/models/EmailNotification';
import NotificationCampaign from '../src/models/NotificationCampaign';
import User from '../src/models/User';
import { listingReviewNotification, buyerInterestNotification } from '../src/models/notification-intent';
import { enqueueAutomaticNotification } from '../src/services/automatic-notifications';
import { sendMarketplaceEmail } from '../src/services/email.service';
import { processMarketplaceEmail } from '../src/services/email-notification-worker';

const buyer = '507f1f77bcf86cd799439011', seller = '507f1f77bcf86cd799439012', listingId = '507f1f77bcf86cd799439013', conversationId = '507f1f77bcf86cd799439014';
function chain(data: unknown) { return { select: () => chain(data), lean: async () => data }; }
function mailEnvironment(t: any) {
  const previous = { user: process.env.GMAIL_USER, password: process.env.GMAIL_APP_PASSWORD, push: process.env.ONESIGNAL_REST_API_KEY };
  process.env.GMAIL_USER = 'sender@example.test'; process.env.GMAIL_APP_PASSWORD = 'test app password'; delete process.env.ONESIGNAL_REST_API_KEY;
  t.after(() => {
    for (const [key, value] of [['GMAIL_USER', previous.user], ['GMAIL_APP_PASSWORD', previous.password], ['ONESIGNAL_REST_API_KEY', previous.push]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}
const interest = () => buyerInterestNotification({ conversationId, listingId, buyerId: buyer, sellerId: seller, title: 'Desk', offer: false });

test('approval, rejection and buyer interest each queue one email and push for the same owner/event', async t => {
  const emails = new Map(); const pushes = new Map();
  t.mock.method(NotificationCampaign, 'updateOne', async (filter: any, update: any) => { if (!pushes.has(filter.eventKey)) pushes.set(filter.eventKey, update.$setOnInsert); return {}; });
  t.mock.method(EmailNotification, 'updateOne', async (filter: any, update: any, options: any) => { assert.equal(options.upsert, true); if (!emails.has(filter.eventKey)) emails.set(filter.eventKey, update.$setOnInsert); return {}; });
  for (const intent of [
    listingReviewNotification({ listingId, sellerId: seller, reviewerId: buyer, title: 'Desk', status: 'approved', reason: '' }),
    listingReviewNotification({ listingId, sellerId: seller, reviewerId: buyer, title: 'Desk', status: 'rejected', reason: 'Please upload a clearer photo.' }),
    interest(),
  ]) {
    await enqueueAutomaticNotification(intent); await enqueueAutomaticNotification(intent);
    assert.equal(emails.get(intent.eventKey).recipientId, seller);
    assert.equal(emails.get(intent.eventKey).body, intent.body);
    await new EmailNotification(emails.get(intent.eventKey)).validate();
  }
  assert.equal(emails.size, 3); assert.equal(pushes.size, 3);
});

test('email templates escape user content and provide matching plain text and useful app instructions', async t => {
  mailEnvironment(t);
  let message: any;
  t.mock.method(nodemailer, 'createTransport', (options: any) => {
    assert.equal(options.auth.pass, 'testapppassword'); assert.equal(options.socketTimeout, 20000);
    return { sendMail: async (mail: any) => { message = mail; } } as any;
  });
  const intent = interest();
  await sendMarketplaceEmail({ email: 'seller@example.test', name: '<Seller>', subject: 'Your <listing> was rejected', body: 'Desk <img src=x onerror=alert(1)> & details', screen: 'my-ads', requestId: intent.requestId });
  assert.equal(message.to.address, 'seller@example.test');
  assert.match(message.html, /&lt;Seller&gt;/); assert.match(message.html, /&lt;img/); assert.equal(message.html.includes('<img'), false);
  assert.match(message.html, /&amp; details/); assert.match(message.text, /Desk <img/); assert.match(message.text, /My Ads/);
  assert.equal(message.messageId, `<bechde-${intent.requestId}@example.test>`);
});

test('verified owners receive email without a push subscription or OneSignal credentials', async t => {
  mailEnvironment(t);
  const intent = interest(); let message: any;
  t.mock.method(EmailNotification, 'findOneAndUpdate', () => chain({ _id: conversationId, ...intent, subject: intent.title, attempts: 1 }) as any);
  t.mock.method(User, 'findOne', (filter: any) => {
    assert.equal(String(filter._id), seller); assert.equal(filter.accountStatus, 'active'); assert.equal(filter.emailVerified, true);
    return chain({ name: 'Seller', email: 'seller@example.test' }) as any;
  });
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (mail: any) => { message = mail; } }) as any);
  t.mock.method(EmailNotification, 'updateOne', async (filter: any, update: any) => { assert.ok(filter.leaseToken); assert.equal(update.$set.status, 'sent'); assert.ok(update.$set.sentAt); return {}; });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Email delivery must not call OneSignal.'); });
  await processMarketplaceEmail();
  assert.equal(message.to.address, 'seller@example.test'); assert.match(message.text, /Start a chat now/); assert.match(message.text, /go to Chats/);
});

test('SMTP failure schedules a retry and retains the same message ID', async t => {
  mailEnvironment(t);
  const intent = interest(); const ids: string[] = []; const outcomes: any[] = []; let attempt = 0;
  t.mock.method(EmailNotification, 'findOneAndUpdate', (filter: any) => {
    assert.ok(filter.$or.some((part: any) => part.status === 'failed' && part.attempts.$lt === 5));
    return chain({ _id: conversationId, ...intent, subject: intent.title, attempts: ++attempt }) as any;
  });
  t.mock.method(User, 'findOne', () => chain({ name: 'Seller', email: 'seller@example.test' }) as any);
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (mail: any) => { ids.push(mail.messageId); if (ids.length === 1) throw new Error('SMTP temporarily unavailable'); } }) as any);
  t.mock.method(EmailNotification, 'updateOne', async (_filter: any, update: any) => { outcomes.push(update.$set); return {}; });
  await processMarketplaceEmail(); await processMarketplaceEmail();
  assert.equal(outcomes[0].status, 'failed'); assert.ok(outcomes[0].nextAttemptAt > new Date());
  assert.equal(outcomes[1].status, 'sent'); assert.equal(ids[0], ids[1]);
});

test('unavailable or unverified recipients are skipped without sending mail', async t => {
  mailEnvironment(t);
  const intent = interest();
  t.mock.method(EmailNotification, 'findOneAndUpdate', () => chain({ _id: conversationId, ...intent, subject: intent.title }) as any);
  t.mock.method(User, 'findOne', () => chain(null) as any);
  t.mock.method(nodemailer, 'createTransport', () => { assert.fail('Unavailable users must not receive mail.'); });
  t.mock.method(EmailNotification, 'updateOne', async (_filter: any, update: any) => { assert.equal(update.$set.status, 'skipped'); return {}; });
  await processMarketplaceEmail();
});

test('missing email credentials leave jobs queued without claiming or blocking push work', async t => {
  mailEnvironment(t); delete process.env.GMAIL_APP_PASSWORD;
  t.mock.method(EmailNotification, 'findOneAndUpdate', () => { assert.fail('No email job should be claimed without SMTP credentials.'); });
  await processMarketplaceEmail();
});
