import crypto from 'node:crypto';
import { Request, Response } from 'express';
import Banner from '../models/Banner';
import { HttpError, objectId, pageNumber, text } from '../utils/http';

const rules = {
  image: { formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'], maxBytes: 10 * 1024 * 1024 },
  video: { formats: ['mp4'], maxBytes: 50 * 1024 * 1024 },
};
function mediaKind(value: unknown): keyof typeof rules {
  if (value !== 'image' && value !== 'video') throw new HttpError(400, 'Choose an image or video banner.');
  return value;
}
function config() {
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloudName || !apiKey || !secret) throw new HttpError(503, 'Configure Cloudinary to upload banners.');
  return { cloudName, apiKey, secret };
}
function order(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10000) throw new HttpError(400, 'Banner order must be a whole number from 0 to 10000.');
  return value;
}
export function signBannerUpload(req: Request, res: Response) {
  const kind = mediaKind(req.body?.kind); const { cloudName, apiKey, secret } = config();
  const params = { allowed_formats: rules[kind].formats.join(','), overwrite: 'false', public_id: `bechde/banners/${crypto.randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)) };
  const signature = crypto.createHash('sha1').update(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&') + secret).digest('hex');
  return res.json({ success: true, cloudName, apiKey, resourceType: kind, params, signature, maxBytes: rules[kind].maxBytes });
}
async function verifyMedia(kind: keyof typeof rules, publicId: unknown) {
  if (typeof publicId !== 'string' || !/^bechde\/banners\/[a-f\d-]{36}$/.test(publicId)) throw new HttpError(400, 'Upload banner media before saving.');
  const { cloudName, apiKey, secret } = config();
  let response: globalThis.Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/resources/${kind}/upload/${encodeURIComponent(publicId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${secret}`).toString('base64')}` }, signal: AbortSignal.timeout(10000) });
  } catch { throw new HttpError(503, 'Unable to verify banner media. Please retry.'); }
  if (!response.ok) throw new HttpError(response.status === 404 ? 400 : 503, 'Unable to verify banner media. Upload it again or retry.');
  const asset = await response.json() as Record<string, unknown>;
  if (asset.resource_type !== kind || asset.public_id !== publicId || !rules[kind].formats.includes(String(asset.format)) || typeof asset.bytes !== 'number' || asset.bytes <= 0 || asset.bytes > rules[kind].maxBytes || typeof asset.secure_url !== 'string' || !asset.secure_url.startsWith('https://')) throw new HttpError(400, 'Use JPG, PNG, WebP or GIF up to 10 MB, or MP4 video up to 50 MB.');
  return { publicId, url: asset.secure_url };
}
export async function publicBanners(_req: Request, res: Response) {
  const data = await Banner.find({ isActive: true }).sort({ sortOrder: 1, _id: 1 }).limit(20).select('title kind url').lean();
  return res.json({ success: true, data });
}
export async function adminBanners(req: Request, res: Response) {
  const page = pageNumber(req.query.page);
  const [data, total] = await Promise.all([Banner.find().sort({ sortOrder: 1, _id: 1 }).skip((page - 1) * 20).limit(20).lean(), Banner.countDocuments()]);
  return res.json({ success: true, data, total, page, pages: Math.ceil(total / 20) });
}
export async function createBanner(req: Request, res: Response) {
  const title = text(req.body?.title, 'Banner title', 120);
  const kind = mediaKind(req.body?.kind);
  const sortOrder = order(req.body?.sortOrder ?? 0);
  if (req.body?.isActive !== undefined && typeof req.body.isActive !== 'boolean') throw new HttpError(400, 'Choose whether the banner is active.');
  const media = await verifyMedia(kind, req.body?.publicId);
  const data = await Banner.create({ title, kind, ...media, sortOrder, isActive: req.body?.isActive ?? true });
  return res.status(201).json({ success: true, data });
}
export async function updateBanner(req: Request, res: Response) {
  const id = objectId(req.params.bannerId);
  const patch: Record<string, unknown> = {};
  if (req.body?.title !== undefined) patch.title = text(req.body.title, 'Banner title', 120);
  if (req.body?.sortOrder !== undefined) patch.sortOrder = order(req.body.sortOrder);
  if (req.body?.isActive !== undefined) {
    if (typeof req.body.isActive !== 'boolean') throw new HttpError(400, 'Choose whether the banner is active.');
    patch.isActive = req.body.isActive;
  }
  if (req.body?.publicId !== undefined) {
    const kind = mediaKind(req.body.kind); Object.assign(patch, await verifyMedia(kind, req.body.publicId), { kind });
  } else if (req.body?.kind !== undefined) throw new HttpError(400, 'Upload replacement media to change the banner type.');
  if (!Object.keys(patch).length) throw new HttpError(400, 'No banner changes provided.');
  const data = await Banner.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true });
  if (!data) throw new HttpError(404, 'Banner not found.');
  return res.json({ success: true, data });
}
export async function deleteBanner(req: Request, res: Response) {
  const data = await Banner.findByIdAndDelete(objectId(req.params.bannerId));
  if (!data) throw new HttpError(404, 'Banner not found.');
  return res.json({ success: true });
}
