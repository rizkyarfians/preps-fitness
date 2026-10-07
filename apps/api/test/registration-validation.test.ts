import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identitySchema, todayIn, completeIdentity, reviewSchema } from '../src/registration-validation.js';
const person={fullName:'Synthetic',address:'Test',phone:'+6281234567890',birthDate:'2000-02-29'};
test('birth dates reject invalid calendar days and keep leap dates',()=>{
 assert.equal(identitySchema.safeParse(person).success,true);
 for(const date of ['2025-02-29','2000-02-30','2000-13-01','0999-01-01','2000-02-29T00:00:00Z'])assert.equal(identitySchema.safeParse({...person,birthDate:date}).success,false);
 assert.equal(completeIdentity({...person,birthDate:'9999-01-01'},'Asia/Jakarta'),false);
});
test('gym calendar date differs from UTC near midnight',()=>{
 assert.equal(todayIn('Asia/Jakarta',new Date('2026-10-07T18:00:00Z')),'2026-10-08');
 assert.equal(todayIn('America/Los_Angeles',new Date('2026-10-07T01:00:00Z')),'2026-10-06');
});
test('review reasons required for reject/clarify and identity rejects injected privilege fields',()=>{
 for(const decision of ['reject','clarify'])assert.equal(reviewSchema.safeParse({decision,version:1,reason:' '}).success,false);
 assert.equal(identitySchema.safeParse({...person,userId:'injected'}).success,false);
});
