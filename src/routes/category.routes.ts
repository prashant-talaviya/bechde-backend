import { Router } from "express";
import {
  getCategories, getCategoryById, getSubcategories, getSubcategoryById, getQuestionnaire
} from "../controllers/category.controller";

const router = Router();
router.get("/", getCategories);
router.get("/:categoryId/subcategories/:subcategoryId/questionnaire", getQuestionnaire);
router.get("/:categoryId/subcategories", getSubcategories);
router.get("/:categoryId", getCategoryById);
router.get("/subcategory/:subcategoryId", getSubcategoryById);
export default router;
