import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateUser } from '../src/controllers/platform-admin.controller';
import { requireAdmin } from '../src/middleware/auth.middleware';
import { validateQuestionnaire } from '../src/utils/questionnaire';
import User from '../src/models/User';
const actor='507f1f77bcf86cd799439011';
const target='507f1f77bcf86cd799439012';
function response(){return {code:200,body:null as any,status(code:number){this.code=code;return this},json(body:unknown){this.body=body;return this}}}
const valid={name:'Test User',mobile:'9876543210',preferredLanguage:'en',role:'user',accountStatus:'active'};
test('ordinary users cannot pass the admin middleware',()=>{
 const res=response();let called=false;
 requireAdmin({userRole:'user'} as any,res as any,()=>{called=true});
 assert.equal(res.code,403);assert.equal(called,false);
});
test('admin cannot revoke own role or block own account',async()=>{
 for(const body of [{...valid,role:'user'},{...valid,role:'admin',accountStatus:'blocked'}]){
  const res=response();await updateUser({params:{userId:actor},userId:actor,body} as any,res as any);
  assert.equal(res.code,400);assert.match(res.body.message,/own/);
 }
});
test('invalid role and phone are rejected before database writes',async()=>{
 for(const body of [{...valid,role:'owner'},{...valid,mobile:'bad'},{...valid,profilePhoto:'javascript:bad'}]){
  const res=response();await updateUser({params:{userId:target},userId:actor,body} as any,res as any);assert.equal(res.code,400);
 }
});
test('user updates whitelist fields and enable validation',async()=>{
 const original=User.findByIdAndUpdate;let update:any;let options:any;
 User.findByIdAndUpdate=((_id:unknown,changes:unknown,opts:unknown)=>{update=changes;options=opts;return {select:async()=>({_id:target})}}) as any;
 try{
  const res=response();await updateUser({params:{userId:target},userId:actor,body:{...valid,email:'overwrite@example.com',emailVerified:true}} as any,res as any);
  assert.equal(res.code,200);assert.equal(update.$set.email,undefined);assert.equal(update.$set.emailVerified,undefined);assert.equal(options.runValidators,true);
 } finally {User.findByIdAndUpdate=original}
});
test('conditional questions must refer to earlier questions',()=>{
 const base={key:'brand',label:'Brand',type:'text'};
 assert.equal(validateQuestionnaire([{...base,showWhen:{field:'brand',operator:'equals',value:'X'}}]).valid,false);
 assert.equal(validateQuestionnaire([base,{key:'model',label:'Model',type:'text',showWhen:{field:'brand',operator:'equals',value:'X'}}]).valid,true);
});

import {editListing} from '../src/controllers/listing-admin.controller';
import Listing from '../src/models/Listing';
test('admin edits whitelist listing fields, validate price and reject stale changes',async()=>{
 const original=Listing.findOneAndUpdate;let changes:any;let filter:any;let conflict=false;
 (Listing as any).findOneAndUpdate=async(query:any,update:any)=>{filter=query;changes=update.$set;return conflict?null:changes};
 async function save(overrides:object={}){const res=response();await editListing({params:{listingId:target},body:{title:'Edited',description:'Description',price:100,location:'Delhi',updatedAt:'2026-01-01T00:00:00Z',status:'approved',sellerId:'forged',...overrides}} as any,res as any,e=>{throw e});return res;}
 try{
 assert.equal((await save({price:-1})).code,400);assert.equal(changes,undefined);
 assert.equal((await save()).code,200);assert.deepEqual(Object.keys(changes).sort(),['description','location','price','title']);assert.ok(filter.updatedAt instanceof Date);
 conflict=true;assert.equal((await save()).code,409);
 }finally{Listing.findOneAndUpdate=original;}
});
