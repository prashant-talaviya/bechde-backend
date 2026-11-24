import crypto from "node:crypto";
import { Request, Response } from "express";

export const signAdminImageUpload = (req: Request, res: Response) => {
  const purpose = req.body.purpose || "general";
  if (!["categories", "subcategories", "banners", "products", "profiles", "general"].includes(purpose)) {
    return res.status(400).json({ success: false, message: "Invalid image purpose." });
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !secret) {
    return res.status(503).json({ success: false, message: "Configure Cloudinary on the backend to enable image uploads." });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `bechde/${purpose}/${crypto.randomUUID()}`;
  const allowedFormats = "jpg,jpeg,png,webp,gif,avif";
  const signature = crypto.createHash("sha1")
    .update(`allowed_formats=${allowedFormats}&public_id=${publicId}&timestamp=${timestamp}${secret}`).digest("hex");
  return res.json({ success: true, cloudName, apiKey, timestamp, publicId, allowedFormats, signature });
};
