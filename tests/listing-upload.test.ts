import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from '../../BechDe/node_modules/typescript/lib/typescript.js';

function evaluate(source:string,imports:Record<string,unknown>,globals:Record<string,unknown>={}) {
 const exports:Record<string,any>={};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,require:(name:string)=>{assert.ok(name in imports,`Unexpected dependency ${name}`);return imports[name]},Blob,Uint8Array,TextEncoder,AbortSignal,...globals});
 return exports;
}
test('native listing photo uploads use File parts accepted by the installed Expo SDK converter',async()=>{
 const appRoot=resolve('../BechDe');
 const converter=evaluate(readFileSync(resolve(appRoot,'node_modules/expo/src/winter/fetch/convertFormData.ts'),'utf8'),{'../../utils/blobUtils':{blobToArrayBufferAsync:(blob:Blob)=>blob.arrayBuffer()}});
 const patch=evaluate(readFileSync(resolve(appRoot,'node_modules/expo/src/winter/FormData.ts'),'utf8'),{});
 class NativeFormData {_parts:any[]=[];}
 const Form=patch.installFormDataPatch(NativeFormData);
 class NativeFile {
  name='phone.jpg';type='image/jpeg';size=4;
  constructor(public uri:string){}
  async bytes(){return new Uint8Array([1,2,3,4]);}
 }
 const signed={cloudName:'demo',apiKey:'public-key',resourceType:'image',signature:'signed',maxBytes:10485760,params:{public_id:'owned-image',allowed_formats:'jpg,jpeg,png',overwrite:'false',timestamp:'123'}};
 let signCalls=0,uploadCalls=0;
 const service=evaluate(readFileSync(resolve(appRoot,'src/services/listing-media.ts'),'utf8'),{
  'expo-file-system':{File:NativeFile},'react-native':{Platform:{OS:'android'}},
  './listings':{listingRequest:async()=>{signCalls++;return signed}},
 },{FormData:Form,fetch:async(url:string,options:any)=>{
  uploadCalls++;assert.equal(url,'https://api.cloudinary.com/v1_1/demo/image/upload');
  const part=options.body.get('file');assert.ok(part instanceof NativeFile);
  const encoded=await converter.convertFormDataAsync(options.body,'test-boundary');
  assert.ok(encoded.body.length>4);
  return new Response(JSON.stringify({secure_url:'https://res.cloudinary.com/demo/image/upload/owned-image.jpg',public_id:'owned-image',bytes:4}));
 }});
 const uploaded=await service.uploadListingMedia('token','image',{uri:'file:///phone.jpg',name:'phone.jpg',mimeType:'image/jpeg',size:4});
 assert.equal(uploaded.kind,'image');assert.equal(uploaded.publicId,'owned-image');assert.equal(uploadCalls,1);
 await assert.rejects(service.uploadListingMedia('token','image',{uri:'file:///phone.gif',name:'phone.gif',mimeType:'image/gif'}),/Only JPG and PNG/);
 assert.equal(signCalls,1);
 // Reproduce the original error against the same installed Expo serializer.
 const previous=new Form();previous.append('file',{uri:'file:///phone.jpg',name:'phone.jpg',type:'image/jpeg'});
 await assert.rejects(converter.convertFormDataAsync(previous),/Unsupported FormDataPart implementation/);
});
