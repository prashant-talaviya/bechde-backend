import {test} from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Category from '../src/models/Category';
import Subcategory from '../src/models/Subcategory';
import {requireSubcategoryParent} from '../src/middleware/category-parent.middleware';
import {deleteCategory,deleteSubcategory,deleteQuestion,deleteQuestionnaire,createSubcategory} from '../src/controllers/category.controller';
const parent='507f1f77bcf86cd799439011',child='507f1f77bcf86cd799439012';
function response(){return {code:200,body:null as any,locals:{categoryId:parent},status(code:number){this.code=code;return this},json(body:unknown){this.body=body;return this}}}
test('legacy child operations require an explicit valid parent',async()=>{
 const res=response();let next=false;await requireSubcategoryParent({params:{subcategoryId:child},body:{},query:{}} as any,res as any,()=>{next=true});assert.equal(res.code,400);assert.equal(next,false);
});
test('wrong parent-child combinations are rejected',async()=>{
 const p=Category.exists,c=Subcategory.exists;let next=false;
 Category.exists=(async()=>({_id:parent})) as any;Subcategory.exists=(async()=>null) as any;
 try{const res=response();await requireSubcategoryParent({params:{categoryId:parent,subcategoryId:child},body:{},query:{}} as any,res as any,()=>{next=true});assert.equal(res.code,404);assert.equal(next,false)}finally{Category.exists=p;Subcategory.exists=c}
});
test('missing parents reject child operations',async()=>{
 const original=Category.exists;Category.exists=(async()=>null) as any;
 try{const res=response();await requireSubcategoryParent({params:{categoryId:parent,subcategoryId:child},body:{},query:{}} as any,res as any,()=>{throw Error('should not proceed')});assert.equal(res.code,404)}finally{Category.exists=original}
});
test('conflicting route and body parent IDs are rejected',async()=>{
 const res=response();await requireSubcategoryParent({params:{categoryId:parent,subcategoryId:child},body:{categoryId:child},query:{}} as any,res as any,()=>{throw Error('should not proceed')});assert.equal(res.code,400);
});
test('category deletion restricts existing children and shares the transaction session',async()=>{
 const transaction=mongoose.connection.transaction,find=Category.findOneAndUpdate,exists=Subcategory.exists,remove=Category.deleteOne;const session={test:true};let deleted=false;
 mongoose.connection.transaction=(async(fn:any)=>fn(session)) as any;
 Category.findOneAndUpdate=(async(_f:any,_u:any,opts:any)=>{assert.equal(opts.session,session);return {slug:'cars'}}) as any;
 Subcategory.exists=(()=>({session:async(s:any)=>{assert.equal(s,session);return {_id:child}}})) as any;
 Category.deleteOne=(async()=>{deleted=true}) as any;
 try{const res=response();await deleteCategory({params:{categoryId:parent}} as any,res as any);assert.equal(res.code,409);assert.equal(deleted,false)}finally{mongoose.connection.transaction=transaction;Category.findOneAndUpdate=find;Subcategory.exists=exists;Category.deleteOne=remove}
});
test('empty category deletion commits using the same parent and session',async()=>{
 const transaction=mongoose.connection.transaction,find=Category.findOneAndUpdate,exists=Subcategory.exists,remove=Category.deleteOne;const session={};let deleted=false;
 mongoose.connection.transaction=(async(fn:any)=>fn(session)) as any;Category.findOneAndUpdate=(async()=>({slug:'cars'})) as any;Subcategory.exists=(()=>({session:async()=>null})) as any;
 Category.deleteOne=(async(filter:any,opts:any)=>{assert.equal(filter._id,parent);assert.equal(opts.session,session);deleted=true}) as any;
 try{const res=response();await deleteCategory({params:{categoryId:parent}} as any,res as any);assert.equal(res.code,200);assert.equal(deleted,true)}finally{mongoose.connection.transaction=transaction;Category.findOneAndUpdate=find;Subcategory.exists=exists;Category.deleteOne=remove}
});
test('subcategory creation locks the parent and creates the child in the same transaction',async()=>{
 const transaction=mongoose.connection.transaction,find=Category.findOneAndUpdate,create=Subcategory.create;const session={};
 mongoose.connection.transaction=(async(fn:any)=>fn(session)) as any;
 Category.findOneAndUpdate=(async(filter:any,update:any,opts:any)=>{assert.equal(filter._id,parent);assert.equal(update.$inc.__v,1);assert.equal(opts.session,session);return {_id:parent}}) as any;
 Subcategory.create=(async(docs:any[],opts:any)=>{assert.equal(docs[0].categoryId,parent);assert.equal(opts.session,session);return [{_id:child}]}) as any;
 try{const res=response();await createSubcategory({params:{categoryId:parent},body:{name:'Phones',slug:'phones'}} as any,res as any);assert.equal(res.code,201)}finally{mongoose.connection.transaction=transaction;Category.findOneAndUpdate=find;Subcategory.create=create}
});
test('subcategory deletion filters by both IDs and removes the embedded document',async()=>{
 const original=Subcategory.findOneAndDelete;
 Subcategory.findOneAndDelete=(async(filter:any)=>{assert.equal(filter._id,child);assert.equal(filter.categoryId,parent);return {_id:child}}) as any;
 try{const res=response();await deleteSubcategory({params:{subcategoryId:child}} as any,res as any);assert.equal(res.code,200)}finally{Subcategory.findOneAndDelete=original}
});
test('questionnaire deletion clears the array and increments version atomically',async()=>{
 const original=Subcategory.findOneAndUpdate;
 Subcategory.findOneAndUpdate=((filter:any,update:any)=>{assert.equal(filter.categoryId,parent);assert.deepEqual(update.$set.questionnaire,[]);assert.equal(update.$inc.questionnaireVersion,1);assert.equal(update.$inc.__v,1);return {select:async()=>({questionnaire:[]})}}) as any;
 try{const res=response();await deleteQuestionnaire({params:{subcategoryId:child}} as any,res as any);assert.equal(res.code,200)}finally{Subcategory.findOneAndUpdate=original}
});
test('question referenced by conditional descendants cannot be deleted',async()=>{
 const original=Subcategory.findById;let saved=false;
 Subcategory.findById=(async()=>({questionnaire:[{key:'brand'},{key:'model',showWhen:{field:'brand'}},{key:'variant',showWhen:{field:'model'}}],save:async()=>{saved=true}})) as any;
 try{const res=response();await deleteQuestion({params:{subcategoryId:child,questionKey:'brand'}} as any,res as any);assert.equal(res.code,409);assert.equal(saved,false)}finally{Subcategory.findById=original}
});
