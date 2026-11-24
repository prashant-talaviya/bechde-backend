import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: "user" | "admin";
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Access token required" });
    }
    const token = header.slice(7).trim();
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof decoded === "string" || decoded.purpose !== "access" ||
        typeof decoded.userId !== "string" || !mongoose.isValidObjectId(decoded.userId)) {
      return res.status(401).json({ success: false, message: "Invalid access token" });
    }
    const user = await User.findById(decoded.userId).select("_id role accountStatus");
    if (!user || user.accountStatus !== "active") {
      return res.status(401).json({ success: false, message: "Account unavailable" });
    }
    req.userId = user._id.toString();
    req.userRole = user.role;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ success: false, message: "Access token is invalid or expired" });
    }
    return next(error);
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  return next();
};
