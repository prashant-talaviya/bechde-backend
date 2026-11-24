import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';

export const overview = async (req: AuthRequest, res: Response) => {
  const [users, blockedUsers, admins, categories, subcategories] = await Promise.all([
    User.countDocuments(), User.countDocuments({accountStatus:'blocked'}),
    User.countDocuments({role:'admin',accountStatus:'active'}), Category.countDocuments(), Subcategory.countDocuments()
  ]);
  return res.json({success:true,data:{users,blockedUsers,admins,categories,subcategories,currentUserId:req.userId}});
};
export const listUsers = async (req: AuthRequest, res: Response) => {
  const requestedPage = Number(req.query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const search = String(req.query.search || '').slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const filter: mongoose.QueryFilter<import('../models/User').IUser> = {};
  if(search) filter.$or = ['name','email','mobile'].map(field=>({[field]:{$regex:search,$options:'i'}}));
  if(['user','admin'].includes(String(req.query.role))) filter.role = String(req.query.role) as "admin" | "user";
  if(['active','blocked'].includes(String(req.query.status))) filter.accountStatus = String(req.query.status) as "active" | "blocked";
  const [data,total] = await Promise.all([
    User.find(filter).select('name email mobile gender profilePhoto preferredLanguage address role accountStatus emailVerified onesignal_subscription_id createdAt updatedAt').sort({createdAt:-1}).skip((page-1)*20).limit(20).lean(),
    User.countDocuments(filter)
  ]);
  return res.json({success:true,data,total,page,pages:Math.ceil(total/20)});
};
export const updateUser = async (req: AuthRequest, res: Response) => {
  const id = String(req.params.userId).toLowerCase();
  if(!mongoose.isValidObjectId(id)) return res.status(400).json({success:false,message:'Invalid user ID.'});
  const {name,mobile,preferredLanguage,profilePhoto,role,accountStatus} = req.body;
  if(typeof name!=='string'||name.trim().length<2||name.trim().length>100) return res.status(400).json({success:false,message:'Name must contain 2–100 characters.'});
  if(typeof mobile!=='string'||!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({success:false,message:'Enter a valid Indian mobile number.'});
  if(typeof preferredLanguage!=='string'||!/^[a-z]{2,10}(-[A-Z]{2})?$/.test(preferredLanguage)) return res.status(400).json({success:false,message:'Invalid language code.'});
  if(!['admin','user'].includes(role)||!['active','blocked'].includes(accountStatus)) return res.status(400).json({success:false,message:'Invalid role or account status.'});
  if(id===req.userId&&(role!=='admin'||accountStatus!=='active')) return res.status(400).json({success:false,message:'You cannot block your own account or remove your own admin access.'});
  if(profilePhoto && (typeof profilePhoto!=='string'||profilePhoto.length>2048||!/^https:\/\//.test(profilePhoto))) return res.status(400).json({success:false,message:'Profile photo must be an HTTPS URL.'});
  try {
    const data = await User.findByIdAndUpdate(id,{$set:{name:name.trim(),mobile,preferredLanguage,profilePhoto:profilePhoto||null,role,accountStatus}},{new:true,runValidators:true}).select('name email mobile preferredLanguage profilePhoto role accountStatus address createdAt');
    if(!data) return res.status(404).json({success:false,message:'User not found.'});
    return res.json({success:true,data,message:'User updated.'});
  } catch(e) {
    if((e as {code?:number}).code===11000) return res.status(409).json({success:false,message:'Mobile number is already in use.'});
    throw e;
  }
};
export const listSubcategories = async (req: AuthRequest,res:Response) => {
  const id = String(req.params.categoryId);
  if(!mongoose.isValidObjectId(id)) return res.status(400).json({success:false,message:'Invalid category ID.'});
  if(!await Category.exists({_id:id})) return res.status(404).json({success:false,message:'Parent category not found.'});
  const data = await Subcategory.find({categoryId:id}).sort({sortOrder:1,name:1}).lean();
  return res.json({success:true,data});
};

export const saveAllCategory = async (req: AuthRequest,res:Response) => {
 const {name,image,sortOrder,isActive}=req.body;
 if(typeof name!=='string'||!name.trim()||name.trim().length>80||typeof isActive!=='boolean'||!Number.isFinite(sortOrder)) return res.status(400).json({success:false,message:'Provide a name, numeric sort order and active status.'});
 if(image && (typeof image!=='string'||image.length>2048||!/^https?:\/\//.test(image))) return res.status(400).json({success:false,message:'Enter a valid image URL.'});
 const data=await Category.findOneAndUpdate({slug:'all'},{$set:{name:name.trim(),image:image||null,sortOrder,isActive},$setOnInsert:{slug:'all',icon:'grid'}},{upsert:true,new:true,runValidators:true});
 return res.json({success:true,data,message:'All category saved.'});
};
