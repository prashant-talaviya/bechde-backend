# Wishlists, conversations, needs and account management

All routes below use the existing access token in `Authorization: Bearer <token>`.
Admin routes additionally require an active account with the admin role. No new environment variables or dependencies are needed.

## Wishlist

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/wishlist?page=1` | Current user's saved items, 20 per page, with availability |
| GET | `/api/wishlist/listings/:listingId` | Current user's saved state and entry ID |
| PUT | `/api/wishlist/listings/:listingId` | Idempotently save an approved listing |
| DELETE | `/api/wishlist/:entryId` | Remove only the current user's saved entry |
| GET | `/api/admin/wishlists?page=1&userId=...` | Admin view of users and their saved listings |

Wishlist rows reference database listings, so current prices and availability are returned. The mobile wishlist imports the previous account's local favourites on first opening; it retains local entries if importing fails and retries safely. Unavailable old items are skipped.

## Buyer and seller conversations

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/conversations` | Body `{kind: "listing" | "need", targetId}`; recipient is derived on the server |
| GET | `/api/conversations?page=1` | Participant-only inbox, 20 per page |
| GET | `/api/conversations/:id/messages` | Last 50 messages in chronological order |
| GET | `/api/conversations/:id/messages?before=<messageId>` | Older messages |
| GET | `/api/conversations/:id/messages?after=<messageId>` | New messages, up to 50; follow `hasMore` |
| POST | `/api/conversations/:id/messages` | Body `{text, clientId}`; max 2,000 characters; retry using the same client ID |

Only the two participants can read or send messages. Admins are not granted access to private conversations. Starting conversations and sending messages require an approved, available target and active accounts. Closed needs and unavailable ads become read-only. The app polls the focused conversation every 5 seconds and the inbox every 10 seconds. This implementation does not send push notifications or use WebSockets.

## Community needs

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/needs` | Body `{title, description, location, budget?: number \| null}`; always pending approval |
| GET | `/api/needs?page=1&location=...` | Approved, open needs from active accounts; literal location matching |
| GET | `/api/needs?mine=true&page=1` | Current user's needs, including review feedback |
| PATCH | `/api/needs/:id` | Owner-only body `{isOpen: boolean}`; does not change approval |
| GET | `/api/admin/needs?status=pending&page=1` | Review queue; supports all/pending/approved/rejected |
| PATCH | `/api/admin/needs/:id/review` | Body `{status: "approved" \| "rejected", reviewReason, updatedAt}`; rejects stale updates |

Requesters close needs once fulfilled. Providers contact requesters through a conversation tied to the approved need. Opening a rejected need never bypasses moderation.

## Account administration

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/admin/users/:id?page=1` | Profile, account metadata, counts and paginated listings, needs and wishlist items |
| PATCH | `/api/admin/users/:id/status` | Body `{accountStatus: "active" \| "blocked"}` |
| DELETE | `/api/admin/users/:id` | Body `{confirmEmail}`; permanently removes account and associated marketplace records |

The existing user editor remains available for names, mobile numbers, language, roles and photos. The database checks account status on every protected request, so deactivated accounts cannot use saved access tokens. Their ads and needs are hidden from public results and new messages are blocked. An administrator cannot deactivate or delete their own account. Admin targets must be demoted before deletion.

Deletion uses a **MongoDB transaction**, requiring Atlas or another replica set, as existing category management already does. It removes the user, their listings and needs, saved entries (including other users' entries for the deleted seller's ads), conversations with that user, associated messages and email OTPs. Hosted Cloudinary files are not deleted by this database operation. Review records on other users' content keep their feedback but remove the deleted reviewer reference.

## Validation

Run `npm run build` and `node --import tsx --test tests/*.test.ts` in `backend`.
Run `npm run build` in `website`; run `npm run lint`, `node_modules/.bin/tsc --noEmit` and `node --test tests/*.test.cjs` in `BechDe`.

The automated controller tests mock database queries and the HTTP tests exercise authentication and role middleware. A live replica-set integration test and device walkthrough are still required before production rollout.
