# BechDe API reference

Base URL: `http://localhost:5000`. Paths below include `/api`; do not add it twice.
This reference describes the routes currently registered in `src/app.ts` and `src/routes/`.

## Request conventions

- Send JSON bodies with `Content-Type: application/json`.
- Public endpoints need no token.
- User endpoints require `Authorization: Bearer ACCESS_TOKEN` from login or completed registration. The account must be active.
- Admin endpoints require `Authorization: Bearer ADMIN_TOKEN`, an access token for an active user with database role `admin`.
- Registration endpoints require `Authorization: Bearer REGISTRATION_TOKEN` from email verification. This is different from an access token.
- Replace `:categoryId`, `:subcategoryId`, `:userId` with actual MongoDB `_id` values. Replace `:questionKey` with the question's stable key, for example `brand`.
- GET requests and DELETE requests below have no body unless explicitly stated. Query parameters belong in the URL.
- Example IDs and responses are illustrative. Use IDs and questionnaire versions returned by your database.

## Listing endpoints

### GET `/api/listings`

Public. No body or supported query filters. Returns the latest 100 **approved** database records in descending `createdAt` order, then excludes records whose category or subcategory is inactive or missing. Pending, rejected and legacy records without a status are excluded. Consequently, the response can contain fewer than 100 records. Pagination, search, category filters and geographic filtering are not implemented.

```http
GET http://localhost:5000/api/listings
```

Example response (`200`):

```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "categoryId": {
        "_id": "507f1f77bcf86cd799439011",
        "name": "Mobiles & Tablets",
        "slug": "mobiles-tablets",
        "icon": "smartphone"
      },
      "subcategoryId": {
        "_id": "507f1f77bcf86cd799439012",
        "name": "Mobile Phones"
      },
      "title": "Samsung phone",
      "description": "Working phone in good condition",
      "price": 5000,
      "location": "Delhi",
      "attributes": { "brand": "Samsung", "condition": "Used", "usageMonths": 12 },
      "questionnaireVersion": 2,
      "status": "approved",
      "coverImage": "https://res.cloudinary.com/YOUR_CLOUD/image/upload/v1/bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111.jpg",
      "media": [
        {
          "kind": "image",
          "publicId": "bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111",
          "url": "https://res.cloudinary.com/YOUR_CLOUD/image/upload/v1/bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111.jpg",
          "name": "phone-front.jpg",
          "bytes": 2048
        }
      ],
      "createdAt": "2026-11-03T10:00:00.000Z",
      "updatedAt": "2026-11-03T10:00:00.000Z"
    }
  ]
}
```

The public response excludes `sellerId`, `__v`, `reviewReason`, `reviewedBy` and `reviewedAt`. Each approved record includes `status`, ordered `media` and `coverImage`.

### POST `/api/listings`

User access token required. Submits a listing for admin approval; the seller is taken from the verified token. New ads always have `status: "pending"` and stay out of the public feed until approved. A client-supplied status or coverImage is ignored.

```http
POST http://localhost:5000/api/listings
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "categoryId": "507f1f77bcf86cd799439011",
  "subcategoryId": "507f1f77bcf86cd799439012",
  "questionnaireVersion": 2,
  "title": "Samsung phone",
  "description": "Working phone in good condition",
  "price": 5000,
  "location": "Delhi",
  "attributes": {
    "brand": "Samsung",
    "condition": "Used",
    "usageMonths": 12
  },
  "media": [
    {
      "kind": "image",
      "publicId": "bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111",
      "name": "phone-front.jpg"
    },
    {
      "kind": "image",
      "publicId": "bechde/listings/507f1f77bcf86cd799439014/22222222-2222-2222-2222-222222222222",
      "name": "phone-back.png"
    }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `categoryId` | Yes | Active category; cannot be the reserved `all` shortcut |
| `subcategoryId` | Yes | Active subcategory belonging to `categoryId` |
| `questionnaireVersion` | Yes | Exact numeric version from the questionnaire GET response |
| `title` | Yes | Nonempty trimmed string, maximum 120 characters |
| `description` | Yes | Nonempty trimmed string, maximum 3000 characters |
| `price` | Yes | Finite JSON number greater than or equal to zero; the app uses INR |
| `location` | Yes | Nonempty trimmed string, maximum 250 characters |
| `attributes` | Yes | Object with keys matching this subcategory's questions; use `{}` for no questions |
| `media` | Yes | Ordered array of 1-10 uploaded assets; at least one image required. Each entry: `kind`, `publicId`, `name` |

The example attributes correspond to the questionnaire example below. Your actual required keys and options depend on the selected subcategory. Unknown keys are rejected. Required visible questions must be answered; hidden answers are discarded before persistence. Do not send `sellerId` or use question labels as attribute keys.

Example response (`201`; this abbreviated response shows one attachment; additional attachments and model fields such as timestamps may be present):

```json
{
  "success": true,
  "message": "We'll verify your details and make your ad live after approval.",
  "data": {
    "_id": "507f1f77bcf86cd799439013",
    "sellerId": "507f1f77bcf86cd799439014",
    "categoryId": "507f1f77bcf86cd799439011",
    "subcategoryId": "507f1f77bcf86cd799439012",
    "title": "Samsung phone",
    "description": "Working phone in good condition",
    "price": 5000,
    "location": "Delhi",
    "attributes": { "brand": "Samsung", "condition": "Used", "usageMonths": 12 },
    "questionnaireVersion": 2,
    "status": "pending",
    "coverImage": "https://res.cloudinary.com/YOUR_CLOUD/image/upload/v1/bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111.jpg",
    "media": [
      {
        "kind": "image",
        "publicId": "bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111",
        "url": "https://res.cloudinary.com/YOUR_CLOUD/image/upload/v1/bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111.jpg",
        "name": "phone-front.jpg",
        "bytes": 2048
      }
    ]
  }
}
```

| Status | Meaning |
|---|---|
| `400` | Invalid IDs, listing fields or questionnaire answers |
| `401` | Missing/expired/invalid access token or unavailable account |
| `404` | Category/subcategory unavailable or wrong parent-child combination |
| `409` | Questionnaire version changed; fetch it again and review answers before resubmitting |
| `503` | Cloudinary configuration or media verification unavailable; retry after resolving it |

Example answer validation error:

```json
{
  "success": false,
  "message": "Brand is required",
  "errors": ["Brand is required"]
}
```

User listing routes support GET public collection, GET your own listings, POST submission and POST media signing. Listing detail by ID, edit, delete and drafts are not implemented. Admin review endpoints are documented below.

### Listing integration sequence

1. `GET /api/categories` and select an active category `_id`.
2. `GET /api/categories/:categoryId/subcategories` and select a subcategory `_id`.
3. `GET /api/categories/:categoryId/subcategories/:subcategoryId/questionnaire` and retain `data.questionnaireVersion`.
4. Render questions, collect answers by `key`, and collect listing details. Every category also gets a common photo step; media is separate from dynamic question answers.
5. Sign and upload JPG/PNG images using the media endpoint below. At least one photo is mandatory; the first image in the media array becomes the cover.
6. `POST /api/listings` with an access token, current questionnaire version, and uploaded media IDs. Show the seller: "We'll verify your details and make your ad live after admin approval."
7. An admin reviews the ad at `/admin` in the Listings tab and approves or rejects it. Only approved ads appear in `GET /api/listings`.

### GET `/api/listings/mine?status=all&page=1`

User access token required. No body. Returns only the authenticated seller's listings, including ads under review and rejected ads. Owner identity comes from the access token, never from a query or body sellerId. Missing/invalid access tokens return `401`.

- `status`: optional; `all` (default), `pending`, `approved`, or `rejected`. Invalid values return `400`.
- `page`: optional positive page number, default 1. Page size is 20, newest first.
- Legacy records without status are treated as pending. Listings with deleted categories/subcategories remain visible to their owner.

```http
GET http://localhost:5000/api/listings/mine?status=all&page=1
Authorization: Bearer ACCESS_TOKEN
```

Example response (listing entries are abbreviated):

```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "title": "Samsung phone",
      "price": 5000,
      "location": "Delhi",
      "status": "rejected",
      "reviewReason": "Please provide clearer photos.",
      "coverImage": "https://example.com/phone.jpg",
      "categoryId": { "_id": "507f1f77bcf86cd799439011", "name": "Mobiles & Tablets" },
      "subcategoryId": { "_id": "507f1f77bcf86cd799439012", "name": "Mobile Phones" }
    }
  ],
  "total": 1,
  "page": 1,
  "pages": 1
}
```

The app's Profile screen uses `/api/auth/me` for photo/account details and this endpoint for Your listings. Status labels are Under review (`pending`), Live (`approved`), and Rejected (`rejected`). The owner can see rejection reasons. Reviewer identity and sellerId are excluded from this response. No changes to an ad are made by viewing the profile.

### POST `/api/listings/media/sign`

User access token required. Body:

```json
{ "kind": "image" }
```

Only `kind: "image"` is accepted. Use JPG/JPEG or PNG images, maximum 10 MB each and 10 images per listing. Video, audio, PDF and other image formats are rejected.

Example response (`200`):

```json
{
  "success": true,
  "data": {
    "cloudName": "YOUR_CLOUD",
    "apiKey": "YOUR_PUBLIC_API_KEY",
    "resourceType": "image",
    "params": {
      "allowed_formats": "jpg,jpeg,png",
      "overwrite": "false",
      "public_id": "bechde/listings/507f1f77bcf86cd799439014/11111111-1111-1111-1111-111111111111",
      "timestamp": "1793700000"
    },
    "signature": "GENERATED_SIGNATURE",
    "maxBytes": 10485760
  }
}
```

Request one signature per file (limit: 40 per IP per 15 minutes). Upload the actual file directly to `https://api.cloudinary.com/v1_1/CLOUD_NAME/RESOURCE_TYPE/upload` with multipart fields:

```text
file: <actual file>
api_key: <data.apiKey>
signature: <data.signature>
allowed_formats: <data.params.allowed_formats>
overwrite: false
public_id: <data.params.public_id>
timestamp: <data.params.timestamp>
```

Forward all returned `params` unchanged. Use the upload response's `public_id` as `publicId` in the listing payload. Image IDs do not include extensions. Never fabricate asset IDs from these examples.

The backend looks up every submitted asset using Cloudinary credentials, verifies seller ownership, actual format and byte size, and derives stored URLs. Client-supplied URLs and byte sizes are ignored. Duplicate attachments are rejected. Uploads are immutable through these signatures (`overwrite: false`). The first image is always the cover. The app lets the seller choose another photo as cover by moving it first. Photo requirements apply to every listing, including categories with an empty questionnaire.

Cloudinary credentials must be configured. Uploading files alone does not submit an ad. Removing an attachment from the form does not delete the Cloudinary asset.

## Health endpoints

| Method | Endpoint | Auth | Body | Purpose |
|---|---|---|---|---|
| GET | `/` | Public | None | API welcome/version |
| GET | `/api/health` | Public | None | API health message |

## Authentication and registration

### POST `/api/auth/email/request-otp`

Public. Sends an OTP email. Limited to 5 requests per IP per 15 minutes, with an additional email resend cooldown.

```json
{ "email": "seller@example.com" }
```

### POST `/api/auth/email/verify-otp`

Public. Use the actual code received by email. Limited to 10 attempts per IP per 15 minutes, with additional per-code attempt limits.

```json
{ "email": "seller@example.com", "otp": "123456" }
```

Existing registered users receive an access `token` and `user`. New/incomplete users receive `registrationToken` and must complete registration.

### POST `/api/auth/profile-photo/sign`

Registration token required. Body:

```json
{}
```

Returns `cloudName`, `apiKey`, `timestamp`, `publicId`, and `signature` for direct Cloudinary upload. It does not receive image bytes. Subject to the verification rate limiter.

### POST `/api/auth/complete-registration`

Registration token required.

```json
{
  "agreedToPolicies": true,
  "name": "Demo Seller",
  "mobile": "9876543210",
  "gender": "prefer_not_to_say",
  "profilePhoto": "https://res.cloudinary.com/YOUR_CLOUD/image/upload/YOUR_PHOTO.jpg",
  "preferredLanguage": "en",
  "address": {
    "area": "Connaught Place",
    "city": "New Delhi",
    "state": "Delhi",
    "pincode": "110001",
    "latitude": 28.6315,
    "longitude": 77.2167
  }
}
```

Use your own verified email session and unique mobile number. Name must contain 2-100 characters, mobile must be a 10-digit Indian number beginning with 6-9, and policy consent must be `true`. Gender is optional (`male`, `female`, `other`, `prefer_not_to_say`); profile photo is optional and must be HTTPS if supplied. Address text fields are accepted but are not required or pincode-validated by this controller; coordinates, if supplied, must be a valid numeric pair. Returns `201` with an access token and user.

### GET `/api/auth/me`

User access token required. No body. Returns `{ "success": true, "user": { ... } }` with profile, address, role and account status.

## Location endpoints

Public. Shared limit: 60 requests per minute per IP. Addresses are restricted to India.

### GET `/api/locations/search?q=Connaught%20Place`

No body. `q` must contain 3-150 trimmed characters. Returns `{ "success": true, "results": [...] }` with up to six places. Each place contains `id`, `label` and an `address` with area, city, state, pincode, latitude and longitude.

### GET `/api/locations/reverse?latitude=28.6315&longitude=77.2167`

No body. Both numeric query parameters are required. Returns `{ "success": true, "result": { ... } }` for the selected coordinates. Invalid or non-Indian locations return `400`; provider failures return `503`.

## Public categories and questionnaires

All endpoints in this section are public and have no request body.

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/categories` | Active categories, `count`, and separate `allCategory` shortcut |
| GET | `/api/categories/:categoryId` | Active category in `data` |
| GET | `/api/categories/:categoryId/subcategories` | Active child subcategories in `data` and `count` |
| GET | `/api/categories/subcategory/:subcategoryId` | Active subcategory including questionnaire and version; parent must be active |
| GET | `/api/categories/:categoryId/subcategories/:subcategoryId/questionnaire` | Sorted questions and version for the selected active parent and child |

Example questionnaire request:

```http
GET http://localhost:5000/api/categories/507f1f77bcf86cd799439011/subcategories/507f1f77bcf86cd799439012/questionnaire
```

Illustrative response:

```json
{
  "success": true,
  "data": {
    "subcategory": {
      "id": "507f1f77bcf86cd799439012",
      "name": "Mobile Phones",
      "slug": "mobile-phones"
    },
    "questionnaireVersion": 2,
    "questionnaire": [
      {
        "key": "brand",
        "label": "Brand",
        "type": "select",
        "required": true,
        "options": ["Apple", "Samsung", "Other"],
        "sortOrder": 1
      },
      {
        "key": "condition",
        "label": "Condition",
        "type": "radio",
        "required": true,
        "options": ["New", "Used"],
        "sortOrder": 2
      },
      {
        "key": "usageMonths",
        "label": "Months used",
        "type": "number",
        "required": true,
        "min": 1,
        "max": 120,
        "suffix": "months",
        "sortOrder": 3,
        "showWhen": { "field": "condition", "operator": "equals", "value": "Used" }
      }
    ]
  }
}
```

## Admin categories

Every endpoint from here through the legacy aliases requires an admin access token.

### GET `/api/admin/categories`

No body. Returns all categories, including inactive categories, ordered by `sortOrder`, then name.

### POST `/api/admin/categories`

```json
{
  "name": "Mobiles & Tablets",
  "slug": "mobiles-tablets",
  "icon": "smartphone",
  "description": "Phones, tablets and accessories",
  "image": "https://example.com/mobile-category.jpg",
  "sortOrder": 1,
  "isActive": true
}
```

`name` and `slug` are required. Name maximum: 80 characters. Slug must use lowercase kebab-case and be unique. Other fields are optional; default active status is true, sort order is 0 and icon is `grid`. Returns `201`.

### PUT `/api/admin/categories/:categoryId`

Send only the fields to change. Supported fields: `name`, `slug`, `icon`, `description`, `image`, `sortOrder`.

```json
{
  "name": "Phones & Tablets",
  "slug": "phones-tablets",
  "icon": "smartphone",
  "description": "Updated description",
  "image": null,
  "sortOrder": 2
}
```

### PATCH `/api/admin/categories/:categoryId/status`

```json
{ "isActive": false }
```

Use `true` to reactivate. This endpoint changes the category's status; public child reads require an active parent.

### DELETE `/api/admin/categories/:categoryId`

No body. Permanently deletes an empty category. Returns `409` if any subcategories still reference it, including inactive children, or if it is the reserved `all` shortcut. Delete children first, or hide the category using PATCH status.

### PUT `/api/admin/all-category`

Creates or updates the reserved All shortcut.

```json
{
  "name": "All",
  "image": null,
  "sortOrder": -1,
  "isActive": true
}
```

`name`, numeric `sortOrder` and boolean `isActive` are required. Image is optional; if supplied it must be an HTTP(S) URL. This shortcut cannot contain subcategories or be selected when creating a listing.

## Admin subcategories

### GET `/api/admin/categories/:categoryId/subcategories`

No body. Returns all children, including inactive ones and their embedded questionnaires. The parent must exist.

### POST `/api/admin/categories/:categoryId/subcategories`

```json
{
  "name": "Mobile Phones",
  "slug": "mobile-phones",
  "description": "New and used phones",
  "icon": "smartphone",
  "sortOrder": 1,
  "isActive": true
}
```

Name and slug are required; slug is unique within the parent category. The parent must be active and cannot be `all`. Questionnaire starts empty; configure it through the questionnaire endpoints. Returns `201`. Subcategory image URLs are not supported by this model.

### PUT `/api/admin/categories/:categoryId/subcategories/:subcategoryId`

Supported fields: `name`, `slug`, `description`, `icon`, `sortOrder`. Send only fields to change. Moving a subcategory to another category is not supported.

```json
{
  "name": "Smartphones",
  "slug": "smartphones",
  "description": "Updated phone description",
  "icon": "smartphone",
  "sortOrder": 2
}
```

### PATCH `/api/admin/categories/:categoryId/subcategories/:subcategoryId/status`

```json
{ "isActive": false }
```

Use `true` to reactivate.

### DELETE `/api/admin/categories/:categoryId/subcategories/:subcategoryId`

No body. Permanently deletes the subcategory and its embedded questionnaire. Existing listing documents are not cascade-deleted; the public feed excludes listings with missing category/subcategory references.

## Admin questionnaires and questions

These nested endpoints verify that the subcategory belongs to the supplied category. Changes increment `questionnaireVersion`; fetch the current version before submitting a listing.

### PUT `/api/admin/categories/:categoryId/subcategories/:subcategoryId/questionnaire`

Replaces the complete questionnaire. Send `{ "questionnaire": [] }` to replace it with an empty array.

```json
{
  "questionnaire": [
    {
      "key": "brand",
      "label": "Brand",
      "type": "select",
      "required": true,
      "options": ["Apple", "Samsung", "Other"],
      "sortOrder": 1
    },
    {
      "key": "condition",
      "label": "Condition",
      "type": "radio",
      "required": true,
      "options": ["New", "Used"],
      "sortOrder": 2
    },
    {
      "key": "usageMonths",
      "label": "Months used",
      "type": "number",
      "required": true,
      "min": 1,
      "max": 120,
      "placeholder": "Months since purchase",
      "suffix": "months",
      "helpText": "Only needed for used phones",
      "sortOrder": 3,
      "showWhen": { "field": "condition", "operator": "equals", "value": "Used" }
    }
  ]
}
```

### DELETE `/api/admin/categories/:categoryId/subcategories/:subcategoryId/questionnaire`

No body. Clears all questions and increments the version; keeps the subcategory.

### POST `/api/admin/categories/:categoryId/subcategories/:subcategoryId/questions`

Adds one question. Send a question object directly, without a `questionnaire` wrapper. Returns `201`.

```json
{
  "key": "hasInvoice",
  "label": "Original invoice available?",
  "type": "boolean",
  "required": true,
  "sortOrder": 4
}
```

### PUT `/api/admin/categories/:categoryId/subcategories/:subcategoryId/questions/:questionKey`

For example, replace `:questionKey` with `hasInvoice`. Sends changed fields; the URL key stays unchanged.

```json
{
  "label": "Do you have the original purchase invoice?",
  "required": false,
  "helpText": "Select Yes or No",
  "sortOrder": 5
}
```

### DELETE `/api/admin/categories/:categoryId/subcategories/:subcategoryId/questions/:questionKey`

No body. Removes one question. Returns `409` if another question references it through `showWhen`; update or remove dependent questions first.

### Question definitions and answer examples

Every question needs `key`, `label`, and supported `type`. Key must begin with a letter, contain only letters, digits and underscores, be 2-50 characters long, and be unique within the questionnaire. Label maximum: 120 characters. `required` defaults to false.

| Type | Example attribute value | Definition notes |
|---|---|---|
| `text` | `"Samsung"` | String, up to 3000 characters |
| `textarea` | `"Small scratch on back"` | String, up to 3000 characters |
| `number` | `12` | Numeric answer, optional `min`/`max` |
| `year` | `2024` | Numeric answer, optional `min`/`max` |
| `range` | `80` | One numeric value, optional `min`/`max` |
| `select` | `"Samsung"` | Must be one of `options` |
| `radio` | `"Used"` | Must be one of `options` |
| `multi_select` | `["Charger", "Box"]` | Array of strings from `options` |
| `boolean` | `true` | JSON boolean |
| `checkbox` | `false` | Single JSON boolean, not an array |

`select`, `radio`, and `multi_select` require at least one option. Optional fields: `placeholder`, `options`, `min`, `max`, `suffix`, `helpText`, `sortOrder`, `showWhen`. Bounds must be finite and `min <= max`. Conditions support `equals` and `not_equals`, compare string representations, and must reference an earlier question in the submitted definition array. Keep dependency and display ordering consistent.

## Admin listing approvals

Admin token required for both endpoints. The existing website has a **Listings** tab with pending/approved/rejected/all filters, details, seller information, answers, JPG/PNG photos.

### GET `/api/admin/listings?status=pending&page=1`

No body. `status` is optional and defaults to `pending`; allowed values: `pending`, `approved`, `rejected`, `all`. `page` defaults to 1; page size is 20. Returns `{ "success": true, "data": [...], "total": 1, "page": 1, "pages": 1 }`.

Each item includes status, ordered media, coverImage, attributes, reviewReason, reviewer/time when available, and populated seller (`name`, `email`, `mobile`), category (`name`), and subcategory (`name`, current questionnaire). Legacy ads without a status appear as pending. Missing category/subcategory references do not remove ads from this admin queue.

### PATCH `/api/admin/listings/:listingId/review`

Approve an ad:

```json
{
  "status": "approved",
  "expectedStatus": "pending"
}
```

Reject an ad (reason required):

```json
{
  "status": "rejected",
  "expectedStatus": "pending",
  "reason": "Please provide clear photos matching the advertised item."
}
```

`status` must be `approved` or `rejected`. `expectedStatus` must match the status last read by the admin (`pending`, `approved`, or `rejected`). This prevents conflicting decisions when another admin changes the status. A rejection reason must be nonempty and at most 1000 characters. Approval clears any earlier rejection reason and records the reviewer and review time. An approved ad can be rejected later by sending `expectedStatus: "approved"`; it then disappears from the public feed.

Approval requires an active matching category/subcategory and an uploaded cover photo. Returns `200` with `message` and updated `data`; `400` for invalid inputs; `404` for a missing listing; `409` for changed status, unavailable category/subcategory or missing cover. Non-admin callers cannot review ads.

Existing ads without status are hidden from the public feed until reviewed. Older ads without photos cannot be approved and need to be submitted again with media. There is no automatic approval or database migration that makes existing ads live.

## Admin users, overview and uploads

### GET `/api/admin/overview`

No body. Returns counts of users, blocked users, active admins, categories and subcategories, plus `currentUserId`.

### GET `/api/admin/users?page=1&search=demo&role=user&status=active`

No body. All query parameters are optional. `page` defaults to 1; page size is 20. `search` matches name, email or mobile; `role` accepts `user`/`admin`, and `status` accepts `active`/`blocked`. Response contains `data`, `total`, `page`, and `pages`.

### PUT `/api/admin/users/:userId`

All fields except `profilePhoto` below are required by this endpoint; it is not a partial update.

```json
{
  "name": "Demo Seller",
  "mobile": "9876543210",
  "preferredLanguage": "en",
  "profilePhoto": null,
  "role": "user",
  "accountStatus": "active"
}
```

Name: 2-100 characters; mobile: valid Indian number; preferredLanguage: language code such as `en` or `hi`. Photo must be HTTPS if present. Role: `user` or `admin`; accountStatus: `active` or `blocked`. You cannot block yourself or remove your own admin role. Duplicate mobile returns `409`.

### POST `/api/admin/images/sign`

```json
{ "purpose": "categories" }
```

Purpose is optional (default `general`); allowed values: `categories`, `subcategories`, `banners`, `products`, `profiles`, `general`. Returns Cloudinary `cloudName`, `apiKey`, `timestamp`, `publicId`, `allowedFormats`, and `signature`. This creates an upload signature only, not a listing photo or database image record.

### Direct Cloudinary upload (external service)

After either signing endpoint, send `multipart/form-data` to `https://api.cloudinary.com/v1_1/CLOUD_NAME/image/upload` using returned values:

```text
file: <image file or data URI>
api_key: <apiKey>
timestamp: <timestamp>
public_id: <publicId>
signature: <signature>
allowed_formats: <allowedFormats, only when returned by admin signing>
```

Use the returned `secure_url` in the relevant supported profile/category payload. Never send the Cloudinary API secret to a client. Backend Cloudinary configuration is required; signing returns `503` if unavailable.

## Legacy admin subcategory aliases

These are still registered. Prefer the nested endpoints above. Each alias requires the expected `categoryId` in the JSON body or query string. The table uses query strings so the payload examples are identical to the corresponding nested endpoint; DELETE has no body.

| Method | Alias including required query example | Body example |
|---|---|---|
| PUT | `/api/admin/subcategories/:subcategoryId?categoryId=507f1f77bcf86cd799439011` | `{"name":"Smartphones","slug":"smartphones","description":"Updated description","icon":"smartphone","sortOrder":2}` |
| PATCH | `/api/admin/subcategories/:subcategoryId/status?categoryId=507f1f77bcf86cd799439011` | `{"isActive":false}` |
| DELETE | `/api/admin/subcategories/:subcategoryId?categoryId=507f1f77bcf86cd799439011` | None |
| PUT | `/api/admin/subcategories/:subcategoryId/questionnaire?categoryId=507f1f77bcf86cd799439011` | `{"questionnaire":[{"key":"brand","label":"Brand","type":"text","required":true,"sortOrder":1}]}` |
| DELETE | `/api/admin/subcategories/:subcategoryId/questionnaire?categoryId=507f1f77bcf86cd799439011` | None |
| POST | `/api/admin/subcategories/:subcategoryId/questions?categoryId=507f1f77bcf86cd799439011` | `{"key":"hasInvoice","label":"Invoice available?","type":"boolean","required":false,"sortOrder":4}` |
| PUT | `/api/admin/subcategories/:subcategoryId/questions/:questionKey?categoryId=507f1f77bcf86cd799439011` | `{"label":"Original invoice available?","required":true}` |
| DELETE | `/api/admin/subcategories/:subcategoryId/questions/:questionKey?categoryId=507f1f77bcf86cd799439011` | None |

JSON-body alternative for a legacy status request:

```json
{ "categoryId": "507f1f77bcf86cd799439011", "isActive": false }
```

Missing/invalid parent or child IDs return `400`; missing parents or mismatched children return `404`. A body categoryId that conflicts with a nested route categoryId is rejected. For legacy aliases, the body categoryId takes precedence over the query value; send one consistent parent ID.

## Errors and operational notes

Most handled errors use `{ "success": false, "message": "Explanation" }`; listing answer errors also include `errors`. Unexpected errors passed to Express may not use this JSON shape.

- `400`: invalid request; `401`: invalid authentication; `403`: insufficient access or blocked login; `404`: resource unavailable; `409`: conflict; `429`: rate limit; `503`: configured dependency unavailable or transactions unsupported.
- DELETE category/subcategory endpoints permanently delete records. PATCH status hides them. Older descriptions of these DELETE routes as soft deletes are obsolete.
- Category deletion and subcategory creation require MongoDB Atlas or a replica set because they use transactions.
- Questionnaire edits increment their version. Never hardcode a version in production listing submissions.
- Category/subcategory deletions retain Cloudinary assets; listing references are not cascade-deleted.
- To bootstrap an admin, register normally, then change that user's database `role` to `admin`. There is no public admin-registration endpoint.

From the backend folder:

```bash
npm install
npm run dev
npm run build
npm run seed:categories
```

The seed uses upserts but replaces seeded questionnaire definitions; export customizations before rerunning it.


