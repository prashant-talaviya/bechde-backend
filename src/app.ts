import { publicBanners } from './controllers/banner.controller';
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./routes/auth.routes";
import locationRoutes from "./routes/location.routes";
import categoryRoutes from "./routes/category.routes";
import adminRoutes from "./routes/admin.routes";
import listingRoutes from "./routes/listing.routes";
import communityRoutes from './routes/community.routes';
import { HttpError } from './utils/http';


const app = express();

app.use(helmet());

app.use(cors());

app.use(express.json({ limit: "1mb" }));

app.use(express.urlencoded({ extended: true }));

app.use(morgan("dev"));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to BechDe API",
    version: "1.0.0"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "BechDe API is running"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/categories", categoryRoutes);
app.get("/api/banners", publicBanners);
app.use("/api/admin", adminRoutes);
app.use("/api/listings", listingRoutes);
app.use('/api', communityRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) return res.status(error.status).json({ success: false, message: error.message });
  console.error('API error:', error);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

export default app;
