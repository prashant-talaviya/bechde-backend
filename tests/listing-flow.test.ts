import test from 'node:test';
import assert from 'node:assert/strict';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';
import Listing from '../src/models/Listing';
import router from '../src/routes/listing.routes';
import { reviewListing, adminListListings } from '../src/controllers/listing-admin.controller';
import { verifyListingMedia, signListingUpload } from '../src/utils/listing-media';
const handler = (router as any).stack.find((layer: any) => layer.route?.methods.post && (layer.route.path === '/' || Array.isArray(layer.route.path) && layer.route.path.includes('/'))).route.stack[1].handle;
const categoryId = '507f1f77bcf86cd799439011', subcategoryId = '507f1f77bcf86cd799439012', sellerId='507f1f77bcf86cd799439014';
const imageId=`bechde/listings/${sellerId}/11111111-1111-1111-1111-111111111111`;
const secondImageId=`bechde/listings/${sellerId}/22222222-2222-2222-2222-222222222222`;
const media=[{kind:'image',publicId:imageId,name:'cover.jpg'},{kind:'image',publicId:secondImageId,name:'back.png'}];
function response(){return {code:200,body:null as any,status(code:number){this.code=code;return this},json(body:any){this.body=body;return this}}}
function configure(){
 const saved={cloud:process.env.CLOUDINARY_CLOUD_NAME,key:process.env.CLOUDINARY_API_KEY,secret:process.env.CLOUDINARY_API_SECRET,fetch:globalThis.fetch};
 process.env.CLOUDINARY_CLOUD_NAME='demo';process.env.CLOUDINARY_API_KEY='test-key';process.env.CLOUDINARY_API_SECRET='test-secret';
 globalThis.fetch=async (url:any)=>{
  const id=decodeURIComponent(String(url).split('/upload/')[1]);
  const format=id===secondImageId?'png':'jpg';
  return new Response(JSON.stringify({public_id:id,resource_type:'image',format,bytes:2048,secure_url:`https://res.cloudinary.com/demo/image/upload/${id}.${format}`}),{status:200});
 };
 return ()=>{globalThis.fetch=saved.fetch;for(const [name,value] of [['CLOUDINARY_CLOUD_NAME',saved.cloud],['CLOUDINARY_API_KEY',saved.key],['CLOUDINARY_API_SECRET',saved.secret]]){if(value===undefined)delete process.env[name!];else process.env[name!]=value;}};
}
test('listing validates answers and media, forces pending status and derives cover from first image', async () => {
 const restore=configure();
 const originals = [Category.exists, Subcategory.findOne, Listing.create];
 let parent = true;let saved: any;
 (Category as any).exists = async () => parent;
 (Subcategory as any).findOne = async (filter: any) => {
  assert.equal(filter.categoryId, categoryId);
  return { questionnaireVersion: 2, questionnaire: [
   {key:'condition',label:'Condition',type:'select',required:true,options:['New','Used']},
   {key:'months',label:'Months',type:'number',required:true,min:1,showWhen:{field:'condition',operator:'equals',value:'Used'}}
  ] };
 };
 (Listing as any).create = async (data: any) => { saved = data; return data; };
 async function submit(overrides: object = {}) {
  const res=response();
  await handler({userId:sellerId,body:{categoryId,subcategoryId,questionnaireVersion:2,title:'Phone',description:'Good phone',price:100,location:'Delhi',attributes:{condition:'New',months:10},media,...overrides}},res,(e: unknown)=>{throw e});
  return res;
 }
 try {
  parent=false;assert.equal((await submit()).code,404);assert.equal(saved,undefined);
  parent=true;assert.equal((await submit({questionnaireVersion:1})).code,409);
  assert.equal((await submit({attributes:{condition:'Used'}})).code,400);
  assert.equal((await submit({attributes:{condition:'Fake'}})).code,400);
  assert.equal((await submit({price:-1})).code,400);
  assert.equal((await submit({media:[]})).code,400);
  assert.equal((await submit({media:[{...media[0],kind:'video'}]})).code,400);
  assert.equal((await submit({media:[{kind:'image',publicId:'other-seller/image'}]})).code,400);
  assert.equal((await submit({media:[media[1],media[1]]})).code,400);
  assert.equal(saved,undefined);
  const result=await submit({status:'approved',sellerId:'forged',coverImage:'https://attacker.invalid/photo.jpg'});
  assert.equal(result.code,201);assert.match(result.body.message,/approval/);
  assert.equal(saved.sellerId,sellerId);assert.equal(saved.status,'pending');
  assert.equal(saved.coverImage,saved.media[0].url);
  assert.equal(saved.media[0].publicId,imageId);
  assert.equal(saved.questionnaireVersion,2);assert.deepEqual(saved.attributes,{condition:'New'});
 } finally { [Category.exists,Subcategory.findOne,Listing.create] = originals as any;restore(); }
});
test('media verification checks actual size, type and existence instead of client metadata',async()=>{
 const restore=configure();
 try {
  globalThis.fetch=async()=>new Response(JSON.stringify({public_id:secondImageId,resource_type:'image',format:'jpg',bytes:11*1024*1024,secure_url:'https://example.com/image.jpg'}));
  await assert.rejects(verifyListingMedia([media[1]],sellerId),/file size/);
  for(const format of ['svg','gif','webp','heic','avif']) {
   globalThis.fetch=async()=>new Response(JSON.stringify({public_id:secondImageId,resource_type:'image',format,bytes:2048,secure_url:`https://example.com/image.${format}`}));
   await assert.rejects(verifyListingMedia([media[1]],sellerId),/Unsupported/);
  }
  globalThis.fetch=async()=>new Response('',{status:404});
  await assert.rejects(verifyListingMedia([media[1]],sellerId),/could not be found/);
  await assert.rejects(verifyListingMedia(Array.from({length:11},()=>media[1]),sellerId),/1 to 10/);
 }finally{restore()}
});
test('signed media upload belongs to seller, disallows overwrite, and restricts formats',()=>{
 const restore=configure();
 try {
  const signed=signListingUpload(sellerId,'image');
  assert.ok(signed.params.public_id.startsWith(`bechde/listings/${sellerId}/`));
  assert.equal(signed.params.overwrite,'false');assert.equal(signed.resourceType,'image');
  assert.equal(signed.params.allowed_formats,'jpg,jpeg,png');
  for(const kind of ['audio','video','file']) assert.throws(()=>signListingUpload(sellerId,kind),/Only JPG and PNG/);
  assert.ok(!signed.params.allowed_formats.includes('svg'));assert.equal(signed.signature.length,40);
  assert.throws(()=>signListingUpload(sellerId,'unknown'),/Only JPG and PNG/);
 }finally{restore()}
});
test('admin approval checks cover and taxonomy, records reviewer, and rejects conflicting reviews',async()=>{
 const originals=[Listing.findById,Listing.findOneAndUpdate,Category.exists,Subcategory.exists];
 let stored:any={categoryId,subcategoryId,coverImage:'https://example.com/cover.jpg',media:[{kind:'image',url:'https://example.com/cover.jpg'}]};
 let updated:any;let filter:any;let available=true;let conflict=false;
 (Listing as any).findById=()=>({lean:async()=>stored});
 (Category as any).exists=async()=>available;
 (Subcategory as any).exists=async()=>available;
 (Listing as any).findOneAndUpdate=async(query:any,update:any)=>{filter=query;updated=update.$set;return conflict?null:updated};
 async function review(body:any){const res=response();await reviewListing({userId:sellerId,params:{listingId:categoryId},body} as any,res as any,(e:unknown)=>{throw e});return res}
 try {
  assert.equal((await review({status:'approved'})).code,400);
  assert.equal((await review({status:'rejected',expectedStatus:'pending',reason:''})).code,400);
  assert.equal((await review({status:'approved',expectedStatus:'pending'})).code,200);
  assert.equal(updated.status,'approved');assert.equal(updated.reviewedBy,sellerId);assert.ok(updated.reviewedAt instanceof Date);assert.ok(filter.$or);
  available=false;assert.equal((await review({status:'approved',expectedStatus:'pending'})).code,409);available=true;
  stored={...stored,media:[]};assert.equal((await review({status:'approved',expectedStatus:'pending'})).code,409);
  assert.equal((await review({status:'rejected',expectedStatus:'approved',reason:'Wrong item details'})).code,200);
  assert.equal(updated.reviewReason,'Wrong item details');assert.equal(filter.status,'approved');
  conflict=true;assert.equal((await review({status:'rejected',expectedStatus:'pending',reason:'Invalid'})).code,409);
  stored=null;assert.equal((await review({status:'approved',expectedStatus:'pending'})).code,404);
 }finally{[Listing.findById,Listing.findOneAndUpdate,Category.exists,Subcategory.exists]=originals as any}
});
test('pending admin queue includes legacy ads without a status',async()=>{
 const originals=[Listing.find,Listing.countDocuments];let filter:any;
 const chain:any={sort(){return chain},skip(){return chain},limit(){return chain},populate(){return chain},lean:async()=>[{title:'Legacy ad'}]};
 (Listing as any).find=(value:any)=>{filter=value;return chain};(Listing as any).countDocuments=async()=>1;
 try{const res=response();await adminListListings({query:{}} as any,res as any,(e:unknown)=>{throw e});assert.ok(filter.$or.some((f:any)=>f.status?.$exists===false));assert.equal(res.body.data[0].status,'pending');}
 finally{[Listing.find,Listing.countDocuments]=originals as any}
});
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import User from '../src/models/User';
import app from '../src/app';

test('admin review routes reject anonymous requests and ordinary user tokens',async()=>{
 const originalFind=User.findById;const originalSecret=process.env.JWT_SECRET;
 process.env.JWT_SECRET='listing-tests-only';
 (User as any).findById=()=>({select:async()=>({_id:sellerId,role:'user',accountStatus:'active'})});
 const server=createServer(app);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address() as {port:number};
 const base=`http://127.0.0.1:${address.port}/api/admin/listings`;
 try{
  const anonymous=await fetch(base);assert.equal(anonymous.status,401);
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/listings/mine`)).status,401);
  const token=jwt.sign({userId:sellerId,purpose:'access'},process.env.JWT_SECRET,{expiresIn:'5m'});
  const response=await fetch(`${base}/${categoryId}/review`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({status:'approved',expectedStatus:'pending'})});
  assert.equal(response.status,403);
  assert.equal((await fetch(base,{headers:{Authorization:`Bearer ${token}`}})).status,403);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  User.findById=originalFind;
  if(originalSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=originalSecret;
 }
});

test('owner edits are scoped to seller, revalidate media and return rejected ads to pending',async()=>{
 const restore=configure();const originals=[Listing.findOne,Listing.findOneAndUpdate,Category.exists,Subcategory.findOne];
 let owned=true;let filter:any;let changes:any;let conflict=false;
 (Listing as any).findOne=async(query:any)=>{assert.equal(query.sellerId,sellerId);return owned?{_id:categoryId,updatedAt:new Date('2026-01-01')}:null};
 (Category as any).exists=async()=>true;
 (Subcategory as any).findOne=async()=>({questionnaireVersion:2,questionnaire:[]});
 (Listing as any).findOneAndUpdate=async(query:any,update:any)=>{filter=query;changes=update.$set;return conflict?null:changes};
 async function edit(overrides:object={}){const res=response();await handler({params:{listingId:categoryId},userId:sellerId,body:{categoryId,subcategoryId,questionnaireVersion:2,title:'Edited phone',description:'Updated details',price:200,location:'Delhi',attributes:{},media,...overrides}},res,(e:unknown)=>{throw e});return res;}
 try{
 owned=false;assert.equal((await edit()).code,404);assert.equal(changes,undefined);
 owned=true;assert.equal((await edit({price:-1})).code,400);
 assert.equal((await edit({media:[{kind:'image',publicId:'other-seller/image'}]})).code,400);
 assert.equal((await edit({status:'approved',sellerId:'forged'})).code,201);
 assert.equal(filter.sellerId,sellerId);assert.ok(filter.updatedAt);assert.equal(changes.status,'pending');assert.equal(changes.reviewReason,'');assert.equal(changes.reviewedBy,null);assert.equal(changes.title,'Edited phone');
 conflict=true;assert.equal((await edit()).code,409);
 }finally{[Listing.findOne,Listing.findOneAndUpdate,Category.exists,Subcategory.findOne]=originals as any;restore();}
});

test('single item lookup requires approval and hides private review and seller fields',async()=>{
 const original=Listing.findOne;let filter:any;let selection='';let available=true;
 const chain:any={populate(){return chain},select(value:string){selection=value;return chain},lean:async()=>available?{categoryId:{},subcategoryId:{},sellerId:{accountStatus:'active'},title:'Phone'}:null};
 (Listing as any).findOne=(query:any)=>{filter=query;return chain};
 const detail=(router as any).stack.find((layer:any)=>layer.route?.methods.get&&layer.route.path==='/:listingId').route.stack[0].handle;
 async function load(id:string){const res=response();await detail({params:{listingId:id}},res,(e:unknown)=>{throw e});return res;}
 try{
 assert.equal((await load('invalid')).code,400);
 const detail=await load(categoryId);assert.equal(detail.code,200);assert.deepEqual(filter,{_id:categoryId,status:'approved'});assert.equal(detail.body.data.sellerId,undefined);assert.ok(selection.includes('-reviewReason'));
 available=false;assert.equal((await load(categoryId)).code,404);
 }finally{Listing.findOne=original;}
});
