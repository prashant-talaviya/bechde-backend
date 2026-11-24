import mongoose, { Schema } from 'mongoose';
import { notificationIntentSchema } from './notification-intent';
const mediaSchema = new Schema({
 kind: {type:String,enum:['image'],required:true},
 publicId: {type:String,required:true}, url: {type:String,required:true},
 name: {type:String,required:true,maxlength:200}, bytes: {type:Number,required:true},
}, {_id:false});
const listingSchema = new Schema({
 sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
 subcategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory', required: true },
 title: { type: String, required: true, trim: true, maxlength: 120 },
 description: { type: String, required: true, trim: true, maxlength: 3000 },
 price: { type: Number, required: true, min: 0 },
 location: { type: String, required: true, trim: true, maxlength: 250 },
 attributes: { type: Schema.Types.Mixed, required: true },
 questionnaireVersion: { type: Number, required: true },
 media: {type:[mediaSchema],default:[]},
 coverImage: {type:String,default:null},
 status: {type:String,enum:['pending','approved','rejected'],default:'pending',index:true},
 reviewReason: {type:String,default:'',maxlength:1000},
 reviewedBy: {type:Schema.Types.ObjectId,ref:'User',default:null},
 reviewedAt: {type:Date,default:null},
 pendingNotifications: { type: [notificationIntentSchema], default: [], select: false },
}, { timestamps: true });
listingSchema.index({ status: 1, createdAt: -1, _id: -1 });
listingSchema.index({ status: 1, categoryId: 1, createdAt: -1, _id: -1 });
listingSchema.index({ sellerId: 1, createdAt: -1, _id: -1 });
export default mongoose.model('Listing', listingSchema);
