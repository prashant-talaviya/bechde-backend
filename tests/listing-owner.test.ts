import test from 'node:test';
import assert from 'node:assert/strict';
import Listing from '../src/models/Listing';
import {listOwnListings} from '../src/controllers/listing-owner.controller';
const sellerId='507f1f77bcf86cd799439014';
function response(){return {code:200,body:null as any,status(code:number){this.code=code;return this},json(body:any){this.body=body;return this}}}
test('owner listing query always uses authenticated seller and includes private review states',async()=>{
 const originals=[Listing.find,Listing.countDocuments];
 let filter:any,countFilter:any,skip=-1,limit=-1;
 const chain:any={sort(){return chain},skip(value:number){skip=value;return chain},limit(value:number){limit=value;return chain},populate(){return chain},select(){return chain},lean:async()=>[{title:'Old ad',categoryId:null,subcategoryId:null},{title:'Rejected ad',status:'rejected',reviewReason:'Photos unclear'}]};
 (Listing as any).find=(query:any)=>{filter=query;return chain};
 (Listing as any).countDocuments=async(query:any)=>{countFilter=query;return 2};
 async function load(query:any){const res=response();await listOwnListings({userId:sellerId,query} as any,res as any,(e:unknown)=>{throw e});return res}
 try{
  const all=await load({sellerId:'another-user'});
  assert.equal(all.code,200);assert.deepEqual(filter,{sellerId});assert.deepEqual(countFilter,filter);
  assert.equal(all.body.data[0].status,'pending');assert.equal(all.body.data[1].reviewReason,'Photos unclear');
  assert.equal(skip,0);assert.equal(limit,20);
  await load({status:'pending'});assert.equal(filter.sellerId,sellerId);assert.ok(filter.$or.some((item:any)=>item.status?.$exists===false));
  await load({status:'approved',page:'3'});assert.deepEqual(filter,{sellerId,status:'approved'});assert.equal(skip,40);
  assert.equal((await load({status:'unexpected'})).code,400);
 }finally{[Listing.find,Listing.countDocuments]=originals as any}
});
