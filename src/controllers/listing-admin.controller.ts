import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Listing from '../models/Listing';
import Category from '../models/Category';
import Subcategory from '../models/Subcategory';
import { AuthRequest } from '../middleware/auth.middleware';
import { listingReviewNotification } from '../models/notification-intent';

export async function adminListListings(req: Request, res: Response, next: NextFunction) {
 try {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  if (!['pending','approved','rejected','all'].includes(status)) return res.status(400).json({success:false,message:'Invalid listing status.'});
  const requestedPage = Number(req.query.page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage,100000) : 1;
  // Existing records without a status also require admin review.
  const filter: mongoose.QueryFilter<mongoose.InferSchemaType<typeof Listing.schema>> = status === 'all' ? {} : status === 'pending' ? {$or:[{status:'pending'},{status:{$exists:false}}]} : {status:status as 'approved'|'rejected'};
  const [data,total] = await Promise.all([
   Listing.find(filter).sort({createdAt:-1}).skip((page-1)*20).limit(20)
    .populate('sellerId','name email mobile').populate('categoryId','name').populate('subcategoryId','name questionnaire').lean(),
   Listing.countDocuments(filter),
  ]);
  return res.json({success:true,data:data.map(item=>({...item,status:item.status || 'pending'})),total,page,pages:Math.ceil(total/20)});
 } catch(error) { next(error); }
}
export async function reviewListing(req: AuthRequest, res: Response, next: NextFunction) {
 try {
  const id = String(req.params.listingId || '');
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({success:false,message:'Invalid listing ID.'});
  const {status,expectedStatus} = req.body;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!['approved','rejected'].includes(status) || !['pending','approved','rejected'].includes(expectedStatus) || reason.length > 1000 || (status === 'rejected' && !reason)) return res.status(400).json({success:false,message:'Provide approved/rejected status and expectedStatus. Rejection requires a reason (max 1000 characters).'});
  const listing = await Listing.findById(id).lean();
  if (!listing) return res.status(404).json({success:false,message:'Listing not found.'});
  if (status === 'approved') {
   const [category,sub] = await Promise.all([
    Category.exists({_id:listing.categoryId,isActive:true,slug:{$ne:'all'}}),
    Subcategory.exists({_id:listing.subcategoryId,categoryId:listing.categoryId,isActive:true}),
   ]);
   if (!category || !sub || !listing.media?.some(item=>item.kind==='image') || listing.coverImage !== listing.media.find(item=>item.kind==='image')?.url)
    return res.status(409).json({success:false,message:'Approval requires an active category/subcategory and an uploaded cover photo.'});
  }
  const statusFilter: mongoose.QueryFilter<mongoose.InferSchemaType<typeof Listing.schema>> = expectedStatus === 'pending' ? {$or:[{status:'pending'},{status:{$exists:false}}]} : {status:expectedStatus};
  const notification = status !== expectedStatus ? listingReviewNotification({ listingId: id, sellerId: String(listing.sellerId), reviewerId: req.userId!, title: listing.title, status, reason }) : undefined;
  const data = await Listing.findOneAndUpdate({_id:id,...statusFilter},{$set:{status,reviewReason:status==='rejected'?reason:'',reviewedBy:req.userId,reviewedAt:new Date()}, ...(notification ? { $push: { pendingNotifications: notification } } : {})},{new:true,runValidators:true});
  if (!data) return res.status(409).json({success:false,message:'The listing status changed. Refresh before reviewing again.'});
  return res.json({success:true,message:status==='approved'?'Listing approved and live.':'Listing rejected.',data});
 } catch(error) { next(error); }
}

export async function editListing(req:AuthRequest,res:Response,next:NextFunction){
 try{
 const id=String(req.params.listingId||'');
 if(!mongoose.isValidObjectId(id))return res.status(400).json({success:false,message:'Invalid listing ID.'});
 const {title,description,price,location,updatedAt}=req.body;
 if(typeof title!=='string'||!title.trim()||title.trim().length>120||typeof description!=='string'||!description.trim()||description.trim().length>3000||typeof location!=='string'||!location.trim()||location.trim().length>250||typeof price!=='number'||!Number.isFinite(price)||price<0||!updatedAt||!Number.isFinite(Date.parse(updatedAt)))return res.status(400).json({success:false,message:'Enter valid listing details.'});
 const data=await Listing.findOneAndUpdate({_id:id,updatedAt:new Date(updatedAt)},{$set:{title:title.trim(),description:description.trim(),price,location:location.trim()}},{new:true,runValidators:true});
 if(!data)return res.status(409).json({success:false,message:'Listing changed or removed. Refresh before editing.'});
 return res.json({success:true,data});
 }catch(error){next(error)}
}
