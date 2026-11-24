# OneSignal notifications

The mobile app uses OneSignal app `e7f5b065-7a1e-4479-b8e3-c233d1ae4cc0`.

## Required configuration

1. Add `ONESIGNAL_REST_API_KEY` to the backend `.env` using this OneSignal app's App API / REST API key. Keep it server-side. `ONESIGNAL_APP_ID` may optionally override the default app ID.
2. Configure Android FCM credentials in the OneSignal dashboard using the Firebase service account from the same Firebase project as `app/google-services.json`. The Google Services JSON bundled with Android is client configuration, not the OneSignal server credential.
3. Rebuild and install the native app. OneSignal does not run in Expo Go or in this app's web build. Expo prebuild copies `google-services.json` to Android and applies the Google Services Gradle plugin. The OneSignal plugin configures Firebase Installation ID registration and disables OneSignal's location module; app location still uses Expo Location.
4. For iOS, configure APNs credentials in OneSignal, set `ONESIGNAL_APNS_MODE=production` for TestFlight/App Store builds, and generate a native iOS build. The default bundle ID is `com.bechde.app`; change it in Expo config if your Apple app uses another ID.
5. Restart the backend after adding credentials. Its notification worker starts after MongoDB connects.

## Onboarding and device ownership

Notification branding is configured in `app/app.config.ts`: `assets/notifications/ic_stat_onesignal_default.png` supplies a white BechDe silhouette on transparency for the Android status bar, and `assets/images/icon.png` supplies the full-colour large icon. The editable small-icon source is `assets/notifications/bechde-notification.svg`. The Expo plugin generates the density variants and applies the brand green accent. Rebuild and reinstall the native app after changing these assets; existing installed binaries and already displayed notifications keep their previous icons. iOS uses the app's installed launcher icon.

SDK initialization on the login page creates an anonymous subscription silently. It does not request OS notification permission. Subscription creation may finish later or fail while offline; authentication never waits more than 1.5 seconds for it.

`POST /api/auth/email/verify-otp` (login) and `POST /api/auth/complete-registration` (signup) carry:

```json
{
  "onesignal_subscription_id": "device-subscription-uuid-or-null",
  "onesignal_push_opted_in": false,
  "push_platform": "android"
}
```

The ID may be null until registration completes. Real IDs are validated UUIDs. They are saved to `User.onesignal_subscription_id` after verified authentication. `PushSubscription` keeps every device separately, with one current owner per subscription, so another login does not overwrite the user's other devices. The user field holds the most recently synchronized device ID.

After sign-in/session restore, `OneSignal.login(user._id)` associates the device with the authenticated account's External ID. `PUT /api/auth/push-subscription` synchronizes late IDs, permission changes, and account switches. Foreground events and a 60-second retry synchronize failed writes. Logout calls `OneSignal.logout()` and attempts to detach the current device through `DELETE /api/auth/push-subscription`; other devices remain attached.

The app requests notification permission during the first native startup setup after the splash. If declined, the notifications bell or **Settings → Enable notifications** can request it again or offer device settings when the OS blocks further prompts. An ID alone does not indicate permission to receive alerts. The admin audience only includes active accounts with an opted-in device; OneSignal remains responsible for final device eligibility and delivery.

## Admin promotions

Open **Admin → Notifications** to compose a title/message, preview it, select all eligible accounts or individual users, and choose Home, Sell, or Community needs as the tap destination. The Users detail panel also shows the most recently synchronized subscription ID.

- `GET /api/admin/notifications?page=1`: configuration status, eligible account count, and campaign history.
- `POST /api/admin/notifications`: accepts `requestId` (UUID v4), `title` (80 characters), `body` (500 characters), `screen` (`home`, `sell`, `needs`), `audience` (`all`, `users`), and `userIds` for a selected audience.
- `POST /api/admin/notifications/:campaignId/retry`: retries a failed campaign using its original unsent batch reference. Retries are limited to 29 days to stay within OneSignal's 30-day idempotency window.

All endpoints require an active admin account. Notification sends are rate-limited. Campaigns are stored before dispatch and sent in batches of up to 2,000 External IDs. A database lease supports restarts and multiple backend instances. Each batch keeps a stable idempotency key, including after a network timeout or process crash. The worker rechecks account and subscription eligibility before sending.

`queued` and `sending` indicate pending work. `submitted` means the batches were accepted by OneSignal, or no targets remained eligible at dispatch. It does not mean every device received the notification. Inspect OneSignal's delivery reports for actual delivery. `failed` preserves its cursor and error for an admin retry. Notification history shows submitted user targets, not delivered devices.

## Automatic marketplace alerts

- An actual listing status change to approved or rejected persists a notification intent on that listing in the same database update. Rejected alerts include a shortened reason; My Ads shows the full reason. Reviewing a listing again without changing its status does not alert its owner again. Conflicting or rejected moderation requests do not persist an intent.
- The first successfully saved buyer message or offer in each listing conversation persists one interest-notification intent for the seller. The canonical first buyer message and a conditional conversation update prevent later messages, duplicate requests, and concurrent first sends from repeating the alert. Seller messages and community-need conversations do not produce this notification. Existing conversations are not notified retroactively when another message arrives.
- The notification worker converts these intents to the existing campaign queue using a unique `eventKey`, then acknowledges/removes the intent. If interrupted between these steps, the next run reuses the same event and provider idempotency key. This does not require a new MongoDB transaction deployment mode.
- Automatic sends recheck active-account and opted-in-device eligibility and retry failed sends with backoff, up to five attempts. They appear in Admin → Notifications history and can be retried manually within the existing 29-day safety window. “Submitted” still does not guarantee device delivery.
- Approval/rejection alerts carry `screen: "my-ads"`. Interest alerts carry `screen: "chat"` plus the conversation ID, so tapping opens the correct conversation. Reload/update the mobile JavaScript to enable these destinations and restart the backend to enable the worker changes. No new native dependency is needed.

### Email for automatic alerts

The same listing-approved, listing-rejected, and first-buyer-message/offer events also enqueue an `EmailNotification` using the same unique event key. Event intents are acknowledged only after both push and email jobs have been persisted. Reprocessing an intent does not overwrite an email's delivery state or create another email job. Existing, already-acknowledged events are not backfilled.

Emails use the existing OTP sender credentials (`GMAIL_USER` and `GMAIL_APP_PASSWORD`). They go to the owner's current verified email only while the account is active, independently of push permissions or OneSignal configuration. Templates include escaped HTML, plain text, and instructions to open My Ads or Chats. These are transactional emails; admin promotional campaigns remain push-only.

An independent email worker records `queued`, `sending`, `sent`, `failed`, or `skipped` and retries failures up to five attempts with backoff. Missing Gmail credentials leave emails queued. Email failure does not retry a successful push, and push failure does not prevent email delivery. `sent` means SMTP accepted the message, not confirmed inbox placement. A stable Message-ID accompanies retries, but SMTP cannot guarantee exactly-once delivery if the process stops after acceptance and before recording success.

## Validation commands

Run app lint/typecheck and `node --test tests/notifications.test.cjs` from `app`; run backend build and `npx tsx --test tests/notifications.test.ts tests/automatic-notifications.test.ts tests/marketplace-email.test.ts` from `backend`; run website build/lint from `website`.

For live testing, install the rebuilt app on a physical device, open login, sign in, enable notifications in Settings, confirm its subscription in OneSignal and the admin Users panel, then target only that test account from Admin → Notifications. Sign out/switch accounts and check the association again before a broad campaign. No live campaign is sent by the automated tests.

References: [Expo plugin](https://github.com/OneSignal/onesignal-expo-plugin), [React Native setup](https://documentation.onesignal.com/docs/en/react-native-sdk-setup), [Mobile SDK reference](https://documentation.onesignal.com/docs/en/mobile-sdk-reference), [Push API](https://documentation.onesignal.com/reference/push-notification).
