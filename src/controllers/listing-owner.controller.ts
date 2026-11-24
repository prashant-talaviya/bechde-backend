import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Listing from '../models/Listing';
import { AuthRequest } from '../middleware/auth.middleware';

export async function listOwnListings(req: AuthRequest,res: Response,next: NextFunction) {
 try {
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  if (!['all','pending','approved','rejected'].includes(status)) return res.status(400).json({success:false,message:'Invalid listing status.'});
  const requestedPage = Number(req.query.page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage,100000) : 1;
  const filter: mongoose.QueryFilter<mongoose.InferSchemaType<typeof Listing.schema>> = {sellerId:req.userId};
  if (status === 'pending') filter.$or = [{status:'pending'},{status:{$exists:false}}];
  else if (status !== 'all') filter.status = status as 'approved'|'rejected';
  const [data,total] = await Promise.all([
   Listing.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*20).limit(20)
    .populate('categoryId','name').populate('subcategoryId','name')
    .select('-media -attributes -questionnaireVersion -sellerId -reviewedBy -__v').lean(),
   Listing.countDocuments(filter),
  ]);
  return res.json({success:true,data:data.map(item=>({...item,status:item.status || 'pending'})),total,page,pages:Math.ceil(total/20)});
 } catch(error) { next(error); }
}
