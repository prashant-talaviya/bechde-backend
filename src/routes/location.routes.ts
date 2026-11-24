import { Router } from "express";
import rateLimit from "express-rate-limit";

const router = Router();
router.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false,
  message: { success: false, message: "Please wait before searching again." } }));

// Photon supports autocomplete. The provider can be replaced without updating the app.
const provider = (process.env.PHOTON_URL || "https://photon.komoot.io").replace(/\/$/, "");
const cache = new Map<string, { expires: number; results: Place[] }>();
type Place = { id: string; label: string; address: {
  area: string; city: string; state: string; pincode: string; latitude: number; longitude: number;
} };
export function indianPlaces(data: any): Place[] {
  const seen = new Set<string>();
  return (Array.isArray(data?.features) ? data.features : []).flatMap((feature: any) => {
    const p = feature?.properties;
    const coordinates = feature?.geometry?.coordinates;
    if (String(p?.countrycode).toUpperCase() !== "IN" || feature?.geometry?.type !== "Point" || !Array.isArray(coordinates)) return [];
    const [longitude, latitude] = coordinates;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
    const area = [...new Set([p.name, p.street, p.district].map(text).filter(Boolean))].join(", ");
    const city = text(p.city || p.county);
    const state = text(p.state);
    const pincode = text(p.postcode);
    const label = [...new Set([area, city, state, pincode, "India"].filter(Boolean))].join(", ");
    const id = `${p.osm_type || ""}-${p.osm_id || ""}-${latitude}-${longitude}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, label, address: { area, city, state, pincode, latitude, longitude } }];
  }).slice(0, 6);
}
async function lookup(path: string, params: URLSearchParams) {
  const key = `${path}?${params}`;
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.results;
  const response = await fetch(`${provider}/${key}`, {
    headers: { "User-Agent": "BechDe/1.0 (India address picker)" }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Location service unavailable");
  const results = indianPlaces(await response.json());
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { results, expires: Date.now() + 5 * 60000 });
  return results;
}
router.get("/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 3 || q.length > 150) return res.status(400).json({ success: false, message: "Enter 3 to 150 characters." });
  try {
    const results = await lookup("api/", new URLSearchParams({ q, countrycode: "IN", limit: "6", lang: "en" }));
    return res.json({ success: true, results });
  } catch {
    return res.status(503).json({ success: false, message: "Location search is unavailable. Please try again." });
  }
});
router.get("/reverse", async (req, res) => {
  const latitude = Number(req.query.latitude), longitude = Number(req.query.longitude);
  if (typeof req.query.latitude !== "string" || typeof req.query.longitude !== "string" || !req.query.latitude.trim() || !req.query.longitude.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ success: false, message: "Select a valid map location." });
  }
  try {
    const results = await lookup("reverse", new URLSearchParams({ lat: String(latitude), lon: String(longitude), limit: "1", lang: "en", radius: "1" }));
    if (!results.length) return res.status(400).json({ success: false, message: "Choose an address within India." });
    const result = results[0]!;
    return res.json({ success: true, result: { ...result, address: { ...result.address, latitude, longitude } } });
  } catch {
    return res.status(503).json({ success: false, message: "Unable to confirm this address. Please try again." });
  }
});
export default router;
