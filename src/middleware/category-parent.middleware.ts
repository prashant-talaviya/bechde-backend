import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';

// Apply this to both scoped routes and legacy routes. Legacy callers must supply categoryId.
export const requireSubcategoryParent = async (req: Request, res: Response, next: NextFunction) => {
 const categoryId=String(req.params.categoryId||req.body?.categoryId||req.query.categoryId||'');
 const subcategoryId=String(req.params.subcategoryId||'');
 if(!mongoose.isValidObjectId(categoryId)||!mongoose.isValidObjectId(subcategoryId)) return res.status(400).json({success:false,message:'Valid categoryId and subcategoryId are required.'});
 if(req.params.categoryId && req.body?.categoryId && String(req.body.categoryId)!==categoryId) return res.status(400).json({success:false,message:'Conflicting parent category IDs.'});
 if(!await Category.exists({_id:categoryId})) return res.status(404).json({success:false,message:'Parent category not found.'});
 if(!await Subcategory.exists({_id:subcategoryId,categoryId})) return res.status(404).json({success:false,message:'Subcategory does not belong to this category.'});
 res.locals.categoryId=categoryId;
 next();
};
