import { adminFeedback } from '../controllers/feedback.controller';
import { signBannerUpload, adminBanners, createBanner, updateBanner, deleteBanner } from '../controllers/banner.controller';
import { supportInbox, adminSupportMessages, adminSendSupportMessage } from '../controllers/support.controller';
import { requireSubcategoryParent } from '../middleware/category-parent.middleware';
import rateLimit from 'express-rate-limit';
import { createNotificationCampaign, listNotificationCampaigns, retryNotificationCampaign } from '../controllers/notification.controller';
import { adminWishlists } from '../controllers/wishlist.controller';
import { adminNeeds, reviewNeed } from '../controllers/need.controller';
import { userDetails, userStatus, deleteUser } from '../controllers/user-admin.controller';
import { adminListListings, reviewListing, editListing } from '../controllers/listing-admin.controller';
import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware";
import { signAdminImageUpload } from "../controllers/upload.controller";
import { overview, listUsers, updateUser, listSubcategories, saveAllCategory } from "../controllers/platform-admin.controller";
import {
  adminListCategories, createCategory, updateCategory, setCategoryStatus, deleteCategory,
  createSubcategory, updateSubcategory, setSubcategoryStatus, deleteSubcategory,
  replaceQuestionnaire, addQuestion, updateQuestion, deleteQuestion, deleteQuestionnaire
} from "../controllers/category.controller";

const router = Router();
router.use(requireAuth, requireAdmin);
const promotionLimit = rateLimit({ windowMs: 60000, limit: 5 });
router.get('/feedback', adminFeedback);
router.get('/banners', adminBanners);
router.post('/banners/sign', rateLimit({ windowMs: 60000, limit: 30 }), signBannerUpload);
router.post('/banners', createBanner);
router.patch('/banners/:bannerId', updateBanner);
router.delete('/banners/:bannerId', deleteBanner);
router.get('/support', supportInbox);
router.get('/support/:userId/messages', adminSupportMessages);
router.post('/support/:userId/messages', rateLimit({ windowMs: 60000, limit: 60 }), adminSendSupportMessage);
router.get('/notifications', listNotificationCampaigns);
router.post('/notifications', promotionLimit, createNotificationCampaign);
router.post('/notifications/:campaignId/retry', promotionLimit, retryNotificationCampaign);
router.get('/wishlists', adminWishlists);
router.get('/needs', adminNeeds);
router.patch('/needs/:needId/review', reviewNeed);
router.get('/users/:userId', userDetails);
router.patch('/users/:userId/status', userStatus);
router.delete('/users/:userId', deleteUser);
router.get('/listings',adminListListings);
router.patch('/listings/:listingId',editListing);
router.patch('/listings/:listingId/review',reviewListing);
router.get("/overview", overview);
router.put("/all-category", saveAllCategory);
router.get("/users", listUsers);
router.put("/users/:userId", updateUser);
router.get("/categories/:categoryId/subcategories", listSubcategories);
router.post("/images/sign", signAdminImageUpload);

router.get("/categories", adminListCategories);
router.post("/categories", createCategory);
router.put("/categories/:categoryId", updateCategory);
router.patch("/categories/:categoryId/status", setCategoryStatus);
router.delete("/categories/:categoryId", deleteCategory);

router.post("/categories/:categoryId/subcategories", createSubcategory);
router.use("/subcategories/:subcategoryId", requireSubcategoryParent);
router.put("/subcategories/:subcategoryId", updateSubcategory);
router.patch("/subcategories/:subcategoryId/status", setSubcategoryStatus);
router.delete("/subcategories/:subcategoryId", deleteSubcategory);
router.delete("/subcategories/:subcategoryId/questionnaire", deleteQuestionnaire);
router.put("/subcategories/:subcategoryId/questionnaire", replaceQuestionnaire);
router.post("/subcategories/:subcategoryId/questions", addQuestion);
router.put("/subcategories/:subcategoryId/questions/:questionKey", updateQuestion);
router.delete("/subcategories/:subcategoryId/questions/:questionKey", deleteQuestion);

router.use('/categories/:categoryId/subcategories/:subcategoryId',requireSubcategoryParent);
router.put('/categories/:categoryId/subcategories/:subcategoryId',updateSubcategory);
router.patch('/categories/:categoryId/subcategories/:subcategoryId/status',setSubcategoryStatus);
router.delete('/categories/:categoryId/subcategories/:subcategoryId',deleteSubcategory);
router.put('/categories/:categoryId/subcategories/:subcategoryId/questionnaire',replaceQuestionnaire);
router.delete('/categories/:categoryId/subcategories/:subcategoryId/questionnaire',deleteQuestionnaire);
router.post('/categories/:categoryId/subcategories/:subcategoryId/questions',addQuestion);
router.put('/categories/:categoryId/subcategories/:subcategoryId/questions/:questionKey',updateQuestion);
router.delete('/categories/:categoryId/subcategories/:subcategoryId/questions/:questionKey',deleteQuestion);
export default router;
