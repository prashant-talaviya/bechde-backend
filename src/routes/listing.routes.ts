import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import Listing from '../models/Listing';
import { validateAnswers } from '../utils/questionnaire';
import rateLimit from 'express-rate-limit';
import { MediaError, signListingUpload, verifyListingMedia } from '../utils/listing-media';
import { listOwnListings } from '../controllers/listing-owner.controller';
import { listPublicListings } from '../controllers/listing-feed.controller';
const router = Router();
router.get('/mine', requireAuth, listOwnListings);
router.get('/mine/:listingId',requireAuth,async(req:AuthRequest,res,next)=>{
 try{
 if(!mongoose.isValidObjectId(String(req.params.listingId)))return res.status(400).json({success:false,message:'Invalid listing ID.'});
 const data=await Listing.findOne({_id:req.params.listingId,sellerId:req.userId}).lean();
 if(!data)return res.status(404).json({success:false,message:'Listing not found.'});
 return res.json({success:true,data});
 }catch(error){next(error)}
});
router.get('/:listingId',async(req,res,next)=>{
 try{
 if(!mongoose.isValidObjectId(String(req.params.listingId)))return res.status(400).json({success:false,message:'Invalid listing ID.'});
 const data=await Listing.findOne({_id:req.params.listingId,status:'approved'}).populate({path:'categoryId',select:'name slug',match:{isActive:true}}).populate({path:'subcategoryId',select:'name questionnaire',match:{isActive:true}}).populate({path:'sellerId',select:'accountStatus',match:{accountStatus:'active'}}).select('-reviewReason -reviewedBy -reviewedAt -__v').lean();
 if(!data||!data.categoryId||!data.subcategoryId||!data.sellerId)return res.status(404).json({success:false,message:'This listing is no longer available.'});
 const {sellerId: _sellerId,...publicItem}=data;
 return res.json({success:true,data:publicItem});
 }catch(error){next(error)}
});
router.post('/media/sign', requireAuth, rateLimit({windowMs:15*60*1000,limit:40}), (req: AuthRequest,res,next) => {
 try { return res.json({success:true,data:signListingUpload(req.userId!,req.body.kind)}); }
 catch(error) { if(error instanceof MediaError) return res.status(error.status).json({success:false,message:error.message}); next(error); }
});
router.get('/', (req, res, next) => {
 if (req.headers.authorization) return requireAuth(req, res, next);
 next();
}, listPublicListings);
router.post(['/', '/:listingId/edit'], requireAuth, async (req: AuthRequest, res, next) => {
 try {
  const editId=req.params?.listingId;
  if(editId&&!mongoose.isValidObjectId(String(editId)))return res.status(400).json({success:false,message:'Invalid listing ID.'});
  const existing=editId?await Listing.findOne({_id:editId,sellerId:req.userId}):null;
  if(editId&&!existing)return res.status(404).json({success:false,message:'Listing not found.'});
  const { categoryId, subcategoryId, attributes, questionnaireVersion, price } = req.body;
  if (typeof categoryId !== 'string' || typeof subcategoryId !== 'string' || !mongoose.isValidObjectId(categoryId) || !mongoose.isValidObjectId(subcategoryId))
   return res.status(400).json({ success: false, message: 'Valid category and subcategory IDs are required.' });
  const category = await Category.exists({ _id: categoryId, isActive: true, slug: { $ne: 'all' } });
  const sub = await Subcategory.findOne({ _id: subcategoryId, categoryId, isActive: true });
  if (!category || !sub) return res.status(404).json({ success: false, message: 'Category or subcategory is unavailable. Please choose again.' });
  if (questionnaireVersion !== sub.questionnaireVersion) return res.status(409).json({ success: false, message: 'Questions have changed. Go back and select the subcategory again.' });
  const result = validateAnswers(sub.questionnaire, attributes);
  if (!result.valid) return res.status(400).json({ success: false, message: result.errors.join('\n'), errors: result.errors });
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const location = typeof req.body.location === 'string' ? req.body.location.trim() : '';
  if (!title || title.length > 120 || !description || description.length > 3000 || !location || location.length > 250 || typeof price !== 'number' || !Number.isFinite(price) || price < 0)
   return res.status(400).json({ success: false, message: 'Enter a title, description, location and valid nonnegative price.' });
  const cleanAttributes = Object.fromEntries(sub.questionnaire.filter(q => {
   if (!q.showWhen) return true;
   const equal = String(attributes[q.showWhen.field] ?? '') === q.showWhen.value;
   return q.showWhen.operator === 'equals' ? equal : !equal;
  }).filter(q => attributes[q.key] !== undefined).map(q => [q.key, attributes[q.key]]));
  const media = await verifyListingMedia(req.body.media,req.userId!);
  const payload = { sellerId: req.userId, categoryId, subcategoryId, title, description, price, location, attributes: cleanAttributes, questionnaireVersion: sub.questionnaireVersion, media, coverImage:media.find(item=>item.kind==='image')!.url, status:'pending' as const };
  const data=existing?await Listing.findOneAndUpdate({_id:existing._id,sellerId:req.userId,updatedAt:existing.updatedAt},{$set:{...payload,reviewReason:'',reviewedBy:null,reviewedAt:null}},{new:true,runValidators:true}):await Listing.create(payload);
  if(!data)return res.status(409).json({success:false,message:'Listing changed. Reload before saving.'});
  return res.status(201).json({ success: true, message: "We'll verify your details and make your ad live after approval.", data });
 } catch (error) {
  if(error instanceof MediaError) return res.status(error.status).json({success:false,message:error.message});
  next(error);
 }
});
export default router;
