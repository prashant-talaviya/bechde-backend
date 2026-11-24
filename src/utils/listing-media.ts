import crypto from 'node:crypto';

export const mediaRules = {
 image: { resourceType: 'image', formats: ['jpg','jpeg','png'], maxBytes: 10 * 1024 * 1024 },
} as const;
export type MediaKind = keyof typeof mediaRules;
export type ListingMedia = { kind: MediaKind; publicId: string; url: string; name: string; bytes: number };
export class MediaError extends Error {
 constructor(public status: number, message: string) { super(message); }
}
export function cloudinaryConfig() {
 const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
 const apiKey = process.env.CLOUDINARY_API_KEY;
 const secret = process.env.CLOUDINARY_API_SECRET;
 if (!cloudName || !apiKey || !secret) throw new MediaError(503, 'Media uploads are unavailable. Configure Cloudinary on the backend.');
 return { cloudName, apiKey, secret };
}
export function signListingUpload(sellerId: string, kind: unknown) {
 if (typeof kind !== 'string' || !Object.hasOwn(mediaRules, kind)) throw new MediaError(400, 'Only JPG and PNG images are supported.');
 const rule = mediaRules[kind as MediaKind];
 const { cloudName, apiKey, secret } = cloudinaryConfig();
 const publicId = `bechde/listings/${sellerId}/${crypto.randomUUID()}`;
 const timestamp = Math.floor(Date.now()/1000);
 const params = { allowed_formats: rule.formats.join(','), overwrite: 'false', public_id: publicId, timestamp: String(timestamp) };
 const signature = crypto.createHash('sha1').update(Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&') + secret).digest('hex');
 return { cloudName, apiKey, resourceType: rule.resourceType, params, signature, maxBytes: rule.maxBytes };
}

// Look up each asset server-side: client URLs, sizes and file types are not trusted.
export async function verifyListingMedia(input: unknown, sellerId: string): Promise<ListingMedia[]> {
 if (!Array.isArray(input) || !input.length || input.length > 10) throw new MediaError(400, 'Attach 1 to 10 JPG or PNG images.');
 const seen = new Set<string>();
 const items = input.map((item: unknown) => {
  if (!item || typeof item !== 'object') throw new MediaError(400, 'Invalid media attachment.');
  const raw = item as Record<string, unknown>;
  if (raw.kind !== 'image') throw new MediaError(400, 'Only JPG and PNG images are supported.');
  if (typeof raw.kind !== 'string' || !Object.hasOwn(mediaRules, raw.kind) || typeof raw.publicId !== 'string' || !new RegExp(`^bechde/listings/${sellerId}/[a-f0-9-]{36}$`).test(raw.publicId)) throw new MediaError(400, 'Media must be uploaded using your own listing upload signature.');
  if (seen.has(raw.publicId)) throw new MediaError(400, 'Duplicate media attachments are not allowed.');
  seen.add(raw.publicId);
  return { kind: raw.kind as MediaKind, publicId: raw.publicId, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0,200) : 'Attachment' };
 });
 if (!items.some(item=>item.kind === 'image')) throw new MediaError(400, 'At least one photo is required. The first photo is your cover image.');
 const { cloudName, apiKey, secret } = cloudinaryConfig();
 const verified: ListingMedia[] = [];
 for (const item of items) {
  const rule = mediaRules[item.kind];
  let response: globalThis.Response;
  try {
   response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/${rule.resourceType}/upload/${encodeURIComponent(item.publicId)}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${secret}`).toString('base64')}` }, signal: AbortSignal.timeout(10000),
   });
  } catch { throw new MediaError(503, 'Unable to verify uploaded media. Please retry.'); }
  if (!response.ok) throw new MediaError(response.status === 404 ? 400 : 503, response.status === 404 ? 'An uploaded media file could not be found. Upload it again.' : 'Unable to verify uploaded media. Please retry.');
  const asset = await response.json() as Record<string, unknown>;
  const format = String(asset.format || '').toLowerCase();
  if (asset.public_id !== item.publicId || asset.resource_type !== rule.resourceType || !(rule.formats as readonly string[]).includes(format) || typeof asset.bytes !== 'number' || asset.bytes <= 0 || asset.bytes > rule.maxBytes || typeof asset.secure_url !== 'string' || !asset.secure_url.startsWith('https://')) throw new MediaError(400, 'Unsupported image format or file size. Use JPG or PNG images up to 10 MB each.');
  verified.push({ ...item, url: asset.secure_url, bytes: asset.bytes });
 }
 return verified;
}
