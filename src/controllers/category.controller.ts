import { Request, Response } from "express";
import mongoose from "mongoose";
import Category from "../models/Category";
import Subcategory from "../models/Subcategory";
import { validateQuestionnaire } from "../utils/questionnaire";

const validId = (id: string) => mongoose.isValidObjectId(id);
const cleanSlug = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

class RelationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof RelationError) return res.status(error.status).json({success:false,message:error.message});
  if (error instanceof mongoose.Error.VersionError) return res.status(409).json({success:false,message:'This questionnaire changed. Reload before saving.'});
  if ((error as {code?:number})?.code === 20) return res.status(503).json({success:false,message:'This operation requires MongoDB transactions. Use a replica set or MongoDB Atlas.'});
  if ((error as any)?.code === 11000)
    return res
      .status(409)
      .json({
        success: false,
        message: "A category or subcategory with this slug already exists",
      });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

export const getCategories = async (_req: Request, res: Response) => {
  try {
    const allCategory = await Category.findOne({ slug: "all" }).select("name slug image sortOrder isActive").lean();
    const data = await Category.find({ isActive: true, slug: { $ne: "all" } })
      .select("name slug icon description image sortOrder")
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return res.json({ success: true, count: data.length, data, allCategory });
  } catch (e) {
    return sendError(res, e, "Unable to fetch categories");
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.categoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    const data = await Category.findOne({ _id: id, isActive: true })
      .select("name slug icon description image sortOrder")
      .lean();
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    return res.json({ success: true, data });
  } catch (e) {
    return sendError(res, e, "Unable to fetch category");
  }
};

export const getSubcategories = async (req: Request, res: Response) => {
  try {
    const categoryId = String(req.params.categoryId || "");
    if (!validId(categoryId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    const category = await Category.findOne({
      _id: categoryId,
      isActive: true,
    }).select("_id");
    if (!category)
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    const data = await Subcategory.find({ categoryId, isActive: true })
      .select("name slug description icon sortOrder")
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return res.json({ success: true, count: data.length, data });
  } catch (e) {
    return sendError(res, e, "Unable to fetch subcategories");
  }
};

export const getSubcategoryById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subcategoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    const data = await Subcategory.findOne({ _id: id, isActive: true })
      .select(
        "categoryId name slug description icon sortOrder questionnaire questionnaireVersion",
      )
      .lean();
    if (!data || !await Category.exists({_id:data.categoryId,isActive:true}))
      return res.status(404).json({success:false,message:'Subcategory not found'});
    return res.json({ success: true, data });
  } catch (e) {
    return sendError(res, e, "Unable to fetch subcategory");
  }
};

export const getQuestionnaire = async (req: Request, res: Response) => {
  try {
    const categoryId = String(req.params.categoryId || "");
    const subcategoryId = String(req.params.subcategoryId || "");
    if (!validId(categoryId) || !validId(subcategoryId))
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid category or subcategory ID",
        });
    if(!await Category.exists({_id:categoryId,isActive:true})) return res.status(404).json({success:false,message:"Category not found"});
    const subcategory = await Subcategory.findOne({
      _id: subcategoryId,
      categoryId,
      isActive: true,
    })
      .select("name slug questionnaire questionnaireVersion")
      .lean();
    if (!subcategory)
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    const questionnaire = [...subcategory.questionnaire].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    return res.json({
      success: true,
      data: {
        subcategory: {
          id: subcategory._id,
          name: subcategory.name,
          slug: subcategory.slug,
        },
        questionnaire,
        questionnaireVersion: subcategory.questionnaireVersion,
      },
    });
  } catch (e) {
    return sendError(res, e, "Unable to fetch questionnaire");
  }
};

// ADMIN: categories
export const adminListCategories = async (_req: Request, res: Response) => {
  try {
    const data = await Category.find().sort({ sortOrder: 1, name: 1 }).lean();
    return res.json({ success: true, count: data.length, data });
  } catch (e) {
    return sendError(res, e, "Unable to fetch categories");
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const name = String(req.body.name ?? "").trim();
    const slug = cleanSlug(req.body.slug);
    if (!name || name.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      return res
        .status(400)
        .json({
          success: false,
          message: "Valid name and kebab-case slug are required",
        });
    const data = await Category.create({
      name,
      slug,
      icon: String(req.body.icon || "grid"),
      description: req.body.description,
      image: req.body.image || null,
      sortOrder: Number(req.body.sortOrder || 0),
      isActive: req.body.isActive !== false,
    });
    return res
      .status(201)
      .json({ success: true, message: "Category created", data });
  } catch (e) {
    return sendError(res, e, "Unable to create category");
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.categoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    const update: Record<string, unknown> = {};
    for (const key of ["name", "icon", "description", "image", "sortOrder"])
      if (req.body[key] !== undefined) update[key] = req.body[key];
    if (req.body.slug !== undefined) update.slug = cleanSlug(req.body.slug);
    if (
      update.name !== undefined &&
      (!String(update.name).trim() || String(update.name).length > 80)
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid category name" });
    if (
      update.slug !== undefined &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(update.slug))
    )
      return res.status(400).json({ success: false, message: "Invalid slug" });
    const data = await Category.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    return res.json({ success: true, message: "Category updated", data });
  } catch (e) {
    return sendError(res, e, "Unable to update category");
  }
};

export const setCategoryStatus = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.categoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    if (typeof req.body.isActive !== "boolean")
      return res
        .status(400)
        .json({ success: false, message: "isActive must be boolean" });
    const data = await Category.findByIdAndUpdate(
      id,
      { isActive: req.body.isActive },
      { new: true },
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    return res.json({
      success: true,
      message: "Category status updated",
      data,
    });
  } catch (e) {
    return sendError(res, e, "Unable to update category status");
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
 try {
  const id=String(req.params.categoryId||'');
  if(!validId(id)) return res.status(400).json({success:false,message:'Invalid category ID'});
  const data=await mongoose.connection.transaction(async session=>{
   // Creation also writes this parent: concurrent create/delete operations conflict and retry.
   const category=await Category.findOneAndUpdate({_id:id},{$inc:{__v:1}},{new:true,session});
   if(!category) throw new RelationError(404,'Category not found');
   if(category.slug==='all') throw new RelationError(409,'The All category is a system shortcut. Hide it instead of deleting it.');
   if(await Subcategory.exists({categoryId:id}).session(session)) throw new RelationError(409,'Delete all subcategories first, including hidden subcategories.');
   await Category.deleteOne({_id:id},{session});
   return {_id:id};
  });
  return res.json({success:true,message:'Category permanently deleted',data});
 }catch(e){return sendError(res,e,'Unable to delete category');}
};

// ADMIN: subcategories and questionnaires
export const createSubcategory = async (req: Request, res: Response) => {
  try {
    const categoryId = String(req.params.categoryId || "");
    const name = String(req.body.name ?? "").trim();
    const slug = cleanSlug(req.body.slug);
    if (!validId(categoryId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    if (!name || name.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      return res
        .status(400)
        .json({
          success: false,
          message: "Valid name and kebab-case slug are required",
        });
    const data = await mongoose.connection.transaction(async session => {
      const category = await Category.findOneAndUpdate(
        {_id:categoryId,isActive:true,slug:{$ne:'all'}},{$inc:{__v:1}},{new:true,session});
      if(!category) throw new RelationError(404,'Active parent category not found. The All shortcut cannot have subcategories.');
      const [created] = await Subcategory.create([{
        categoryId,name,slug,description:req.body.description,icon:req.body.icon,
        sortOrder:Number(req.body.sortOrder||0),isActive:req.body.isActive!==false,questionnaire:[]
      }],{session});
      return created;
    });
    return res
      .status(201)
      .json({ success: true, message: "Subcategory created", data });
  } catch (e) {
    return sendError(res, e, "Unable to create subcategory");
  }
};

export const updateSubcategory = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subcategoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    const update: Record<string, unknown> = {};
    for (const key of ["name", "description", "icon", "sortOrder"])
      if (req.body[key] !== undefined) update[key] = req.body[key];
    if (req.body.slug !== undefined) update.slug = cleanSlug(req.body.slug);
    if (
      update.slug !== undefined &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(update.slug))
    )
      return res.status(400).json({ success: false, message: "Invalid slug" });
    const data = await Subcategory.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    return res.json({ success: true, message: "Subcategory updated", data });
  } catch (e) {
    return sendError(res, e, "Unable to update subcategory");
  }
};

export const setSubcategoryStatus = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subcategoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    if (typeof req.body.isActive !== "boolean")
      return res
        .status(400)
        .json({ success: false, message: "isActive must be boolean" });
    const data = await Subcategory.findByIdAndUpdate(
      id,
      { isActive: req.body.isActive },
      { new: true },
    );
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    return res.json({
      success: true,
      message: "Subcategory status updated",
      data,
    });
  } catch (e) {
    return sendError(res, e, "Unable to update subcategory status");
  }
};

export const deleteSubcategory = async (req: Request, res: Response) => {
 try {
  const data=await Subcategory.findOneAndDelete({_id:req.params.subcategoryId,categoryId:res.locals.categoryId});
  if(!data)return res.status(404).json({success:false,message:'Subcategory not found under this category'});
  return res.json({success:true,message:'Subcategory and its embedded questionnaire permanently deleted',data:{_id:data._id}});
 }catch(e){return sendError(res,e,'Unable to delete subcategory');}
};

export const deleteQuestionnaire = async (req: Request, res: Response) => {
 try {
  const data=await Subcategory.findOneAndUpdate({_id:req.params.subcategoryId,categoryId:res.locals.categoryId},
   {$set:{questionnaire:[]},$inc:{questionnaireVersion:1,__v:1}},{new:true,runValidators:true}).select('questionnaire questionnaireVersion');
  if(!data)return res.status(404).json({success:false,message:'Subcategory not found under this category'});
  return res.json({success:true,message:'Questionnaire deleted',data});
 }catch(e){return sendError(res,e,'Unable to delete questionnaire');}
};

export const replaceQuestionnaire = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subcategoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    const result = validateQuestionnaire(req.body.questionnaire);
    if (!result.valid)
      return res.status(400).json({ success: false, message: result.message });
    const data = await Subcategory.findByIdAndUpdate(
      id,
      {
        $set: { questionnaire: result.questions },
        $inc: { questionnaireVersion: 1, __v: 1 },
      },
      { new: true, runValidators: true },
    ).select("name slug questionnaire");
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    return res.json({ success: true, message: "Questionnaire replaced", data });
  } catch (e) {
    return sendError(res, e, "Unable to replace questionnaire");
  }
};

export const addQuestion = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subcategoryId || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    const sub = await Subcategory.findById(id);
    if (!sub)
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    const result = validateQuestionnaire([
      ...sub.questionnaire.map((q) =>
        (q as any).toObject ? (q as any).toObject() : q,
      ),
      req.body,
    ]);
    if (!result.valid)
      return res.status(400).json({ success: false, message: result.message });
    sub.questionnaire = result.questions as any;
    sub.questionnaireVersion = (sub.questionnaireVersion || 0) + 1;
    await sub.save();
    return res
      .status(201)
      .json({
        success: true,
        message: "Question added",
        data: sub.questionnaire,
      });
  } catch (e) {
    return sendError(res, e, "Unable to add question");
  }
};

export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subcategoryId || "");
    const key = String(req.params.questionKey || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    const sub = await Subcategory.findById(id);
    if (!sub)
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    const index = sub.questionnaire.findIndex((q) => q.key === key);
    if (index < 0)
      return res
        .status(404)
        .json({ success: false, message: "Question not found" });
    const questions = sub.toObject().questionnaire;
    const existing = questions[index];
    const merged = { ...existing, ...req.body, key };
    const all = questions.map((q, i) =>
      i === index ? merged : q,
    );
    const result = validateQuestionnaire(all);
    if (!result.valid)
      return res.status(400).json({ success: false, message: result.message });
    sub.questionnaire = result.questions as any;
    sub.questionnaireVersion = (sub.questionnaireVersion || 0) + 1;
    await sub.save();
    return res.json({
      success: true,
      message: "Question updated",
      data: sub.questionnaire,
    });
  } catch (e) {
    return sendError(res, e, "Unable to update question");
  }
};

export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.subcategoryId || "");
    const key = String(req.params.questionKey || "");
    if (!validId(id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid subcategory ID" });
    const sub = await Subcategory.findById(id);
    if (!sub)
      return res
        .status(404)
        .json({ success: false, message: "Subcategory not found" });
    const before = sub.questionnaire.length;
    sub.questionnaire = sub.questionnaire.filter((q) => q.key !== key) as any;
    if (sub.questionnaire.length === before)
      return res
        .status(404)
        .json({ success: false, message: "Question not found" });
    const dependent = sub.questionnaire.find(q=>q.showWhen?.field===key);
    if(dependent) return res.status(409).json({success:false,message:`Question ${dependent.key} depends on ${key}. Remove or update dependent questions first.`});
    const result=validateQuestionnaire(sub.toObject().questionnaire);
    if(!result.valid)return res.status(409).json({success:false,message:result.message});
    sub.questionnaireVersion = (sub.questionnaireVersion || 0) + 1;
    await sub.save();
    return res.json({
      success: true,
      message: "Question deleted",
      data: sub.questionnaire,
    });
  } catch (e) {
    return sendError(res, e, "Unable to delete question");
  }
};
