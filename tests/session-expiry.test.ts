import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenExpiresAt as appExpiry, validToken as appValid } from '../../app/src/services/token';
import { tokenExpiresAt as webExpiry, validToken as webValid } from '../../website/src/token';
const jwt=(payload:unknown)=>`header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
for(const [name,expiry,valid] of [['app',appExpiry,appValid],['admin',webExpiry,webValid]] as const){
 test(`${name}: saved tokens remain valid until their original expiry`,()=>{
  const exp=Math.floor(Date.now()/1000)+7*24*60*60;
  const token=jwt({exp,purpose:'access'});
  assert.equal(valid(token),true);assert.equal(expiry(token),exp*1000);
 });
 test(`${name}: expired, malformed and missing-expiry tokens cannot restore login`,()=>{
  for(const token of [jwt({exp:Math.floor(Date.now()/1000)-1}),jwt({}),jwt({exp:'future'}),'invalid','']) assert.equal(valid(token),false);
 });
}
