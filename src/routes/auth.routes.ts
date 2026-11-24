import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import User from "../models/User";
import { z } from 'zod';
import type { Response } from 'express';
import { bindPushSubscription, pushPayloadSchema } from '../services/push-subscriptions';
import PushSubscription from '../models/PushSubscription';

import {
  requestEmailOTP,
  verifyEmailOTP,
  verifyGoogle,
  completeRegistration,
  signProfilePhotoUpload
} from "../controllers/auth.controller";

const router = Router();
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const user = await User.findById(req.userId).select("name email mobile role accountStatus profilePhoto preferredLanguage address onesignal_subscription_id").lean();
  if (!user) return res.status(401).json({ success: false, message: "Account unavailable" });
  return res.json({ success: true, user });
});

router.put('/push-subscription', requireAuth, async (req: AuthRequest, res) => {
  const parsed = pushPayloadSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.onesignal_subscription_id) return res.status(400).json({ success: false, message: 'A valid subscription ID is required.' });
  await bindPushSubscription(req.userId!, parsed.data);
  return res.json({ success: true });
});
router.delete('/push-subscription', requireAuth, async (req: AuthRequest, res) => {
  const parsed = pushPayloadSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.onesignal_subscription_id) return res.status(400).json({ success: false, message: 'A valid subscription ID is required.' });
  const id = parsed.data.onesignal_subscription_id;
  await PushSubscription.deleteOne({ userId: req.userId, subscriptionId: id });
  await User.updateOne({ _id: req.userId, onesignal_subscription_id: id }, { $set: { onesignal_subscription_id: null } });
  return res.json({ success: true });
});

const locationUpdate = z.object({
  address: z.object({
    area: z.string().trim().max(300).optional(),
    city: z.string().trim().max(150).optional(),
    state: z.string().trim().min(1).max(150),
    pincode: z.string().trim().regex(/^(\d{6})?$/).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  }).strict().refine(address => (address.latitude === undefined) === (address.longitude === undefined), {
    message: 'Provide both latitude and longitude.',
  }),
}).strict();

export async function updateOwnLocation(req: AuthRequest, res: Response) {
  const parsed = locationUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: 'Select a valid location.' });
  // Replace the address so a state or country selection clears old coordinates.
  const user = await User.findByIdAndUpdate(req.userId, { $set: { address: parsed.data.address } }, { new: true, runValidators: true })
    .select('name email mobile gender role accountStatus profilePhoto preferredLanguage address').lean();
  if (!user) return res.status(401).json({ success: false, message: 'Account unavailable' });
  return res.json({ success: true, user });
}
router.patch('/me', requireAuth, updateOwnLocation);

// Each IP can request up to 5 OTP emails in 15 minutes.
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Please try again later."
  }
});

// Limit verification requests separately to slow down code guessing.
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts. Please try again later."
  }
});

router.post(
  "/email/request-otp",
  otpRequestLimiter,
  requestEmailOTP
);

router.post(
  "/email/verify-otp",
  otpVerifyLimiter,
  verifyEmailOTP
);

router.post("/google", otpVerifyLimiter, verifyGoogle);

router.post(
  "/complete-registration",
  completeRegistration,
  signProfilePhotoUpload
);

router.post("/profile-photo/sign", otpVerifyLimiter, signProfilePhotoUpload);

export default router;
