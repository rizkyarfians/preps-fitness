import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../src/db/client.js';
import type { Config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { registrationRouter } from '../src/registration-api.js';
import { user, gymUser, branchAccess, planVersion, member, memberBranch, registrationOrder, registration, candidateCheck } from '../src/db/schema.js';
import type { Offer } from '../src/registration-validation.js';
export async function registrationScenarios(t:TestContext,db:Database,config:Config) {
 const actor='registration-admin',other='registration-admin-2';
 await db.insert(user).values([{id:actor,name:'Test Admin',email:'reg-admin@example.test'},{id:other,name:'Test Admin 2',email:'reg-admin-2@example.test'}]);
 await db.insert(gymUser).values([{gymId:config.GYM_ID,userId:actor},{gymId:config.GYM_ID,userId:other}]);
 await db.insert(branchAccess).values([{gymId:config.GYM_ID,branchId:'branch-a',userId:actor,role:'admin'},{gymId:config.GYM_ID,branchId:'branch-a',userId:actor,role:'member'},{gymId:config.GYM_ID,branchId:'branch-a',userId:other,role:'admin'}]);
 const snapshot:Offer={id:'plan-a',planId:'monthly',version:1,branchId:'branch-a',name:'Monthly',publishedAt:'2026-01-01T00:00:00.000Z',price:{amount:'250000.00',currency:'IDR'},duration:{value:1,unit:'month'},benefits:[]};
 await db.insert(planVersion).values({id:snapshot.id,planId:snapshot.planId,version:1,branchId:'branch-a',gymId:config.GYM_ID,snapshot});
 const app=(id:string)=>createApp({gymId:config.GYM_ID,webOrigin:config.WEB_ORIGIN,authHandler:(_q,s)=>{s.sendStatus(404);},ready:async()=>{},getBranch:async()=>null,resolvePrincipal:async()=>({user:{id,name:'Test',email:'test@example.test'},gymId:config.GYM_ID,enabled:true,grants:[]}),registrationRouter:registrationRouter(db,config)});
 const a=request(app(actor)),b=request(app(other));
 let n=0;
 const identity=(phone?:string)=>({fullName:`Synthetic ${++n}`,phone:phone||`+6281234567${String(n).padStart(3,'0')}`,address:'Synthetic address',birthDate:'2000-02-29'});
 const post=(path:string,body:object,key=`key-${++n}`)=>a.post('/api/v1'+path).set('Origin',config.WEB_ORIGIN).set('Idempotency-Key',key).send(body);
 const draft=async()=>{const r=await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',identity:identity()}).expect(201);return r.body.data.registration;};
 await t.test('real registration context, published plans, strict input and origin checks',async()=>{
  const c=await a.get('/api/v1/registration-context?branchId=branch-a').expect(200);assert.equal(c.body.data.timezone,config.GYM_TIMEZONE);
  await a.get('/api/v1/registration-context?branchId=branch-b').expect(403);
  const p=await a.get('/api/v1/plan-versions?branchId=branch-a').expect(200);assert.equal(p.body.data.items[0].price.amount,'250000.00');
  await a.get('/api/v1/plan-versions/plan-a?branchId=branch-a').expect(200);
  await a.post('/api/v1/registrations').send({}).expect(403);
  for(const bad of [{birthDate:'2025-02-29'},{birthDate:'9999-12-31'},{address:' '},{phone:'0812345678'},{userId:actor}])await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',identity:{...identity(),...bad}}).expect(422);
 });
 await t.test('create retries across eight calls make one profile and one registration; payload conflicts',async()=>{
  const body={branchId:'branch-a',planVersionId:'plan-a',identity:identity()};
  const results=await Promise.all(Array.from({length:8},()=>post('/registrations',body,'create-retry')));
  assert.ok(results.every(r=>[200,201].includes(r.status)));assert.equal(new Set(results.map(r=>r.body.data.registration.id)).size,1);
  await post('/registrations',{...body,identity:identity()},'create-retry').expect(409);
  const r=results[0]!.body.data.registration;const m=await a.get(`/api/v1/members/${r.memberId}?branchId=branch-a`).expect(200);assert.equal(m.body.data.accountLinked,false);
 });
 await t.test('clarification, edit, resubmit and approve produce one unactivated order',async()=>{
  let r=await draft();const route=`/registrations/${r.id}`;
  r=(await post(route+'/submit',{version:r.version}).expect(200)).body.data.registration;
  await post(route+'/review',{version:r.version,decision:'clarify'}).expect(422);
  r=(await post(route+'/review',{version:r.version,decision:'clarify',reason:'Check address'}).expect(200)).body.data.registration;assert.equal(r.status,'needs_clarification');assert.equal(r.orderId,undefined);
  r=(await a.patch('/api/v1'+route).set('Origin',config.WEB_ORIGIN).set('Idempotency-Key','clarify-edit').send({version:r.version,planVersionId:'plan-a',identity:{...r.identity,address:'Corrected address'}}).expect(200)).body.data.registration;
  r=(await post(route+'/submit',{version:r.version}).expect(200)).body.data.registration;
  // Unpublish after submit: the captured offer remains reviewable without repricing.
  await db.update(planVersion).set({selectable:false}).where(eq(planVersion.id,'plan-a'));
  const body={version:r.version,decision:'approve'};
  r=(await post(route+'/review',body,'approve-once').expect(200)).body.data.registration;
  const [stored]=await db.select().from(registration).where(eq(registration.id,r.id));
  assert.equal(stored!.submissions.length,2);assert.notEqual(stored!.submissions[0]!.identity.address,stored!.submissions[1]!.identity.address);
  assert.equal(r.status,'approved');assert.ok(r.orderId);assert.equal(r.history.length,2);assert.equal(r.offer.price.amount,'250000.00');
  const replay=await post(route+'/review',body,'approve-once').expect(200);assert.equal(replay.body.data.replayed,true);
  assert.equal((await db.select().from(registrationOrder).where(eq(registrationOrder.registrationId,r.id))).length,1);
  await post(route+'/review',{version:r.version,decision:'reject',reason:'Too late'}).expect(409);
  await db.update(planVersion).set({selectable:true}).where(eq(planVersion.id,'plan-a'));
 });
 await t.test('two admins race approve versus reject; only one decision wins',async()=>{
  let r=await draft();r=(await post(`/registrations/${r.id}/submit`,{version:r.version}).expect(200)).body.data.registration;
  const path=`/api/v1/registrations/${r.id}/review`;
  const results=await Promise.all([a.post(path).set('Origin',config.WEB_ORIGIN).set('Idempotency-Key','race-a').send({version:r.version,decision:'approve'}),b.post(path).set('Origin',config.WEB_ORIGIN).set('Idempotency-Key','race-b').send({version:r.version,decision:'reject',reason:'Invalid'})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  const result=(await a.get(`/api/v1/registrations/${r.id}`).expect(200)).body.data;
  assert.equal(result.history.length,1);assert.equal((await db.select().from(registrationOrder).where(eq(registrationOrder.registrationId,r.id))).length,result.status==='approved'?1:0);
 });
 await t.test('existing member pending guard and reject terminal state',async()=>{
  let r=await draft();r=(await post(`/registrations/${r.id}/submit`,{version:r.version}).expect(200)).body.data.registration;
  const second=(await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',memberId:r.memberId}).expect(201)).body.data.registration;
  const duplicate=await post(`/registrations/${second.id}/submit`,{version:1}).expect(409);assert.equal(duplicate.body.error.reasonCode,'EXISTING_REGISTRATION');
  const rejection=await post(`/registrations/${r.id}/review`,{version:r.version,decision:'reject',reason:'Not eligible'}).expect(200);assert.equal(rejection.body.data.registration.orderId,undefined);
  await post(`/registrations/${r.id}/submit`,{version:rejection.body.data.registration.version}).expect(409);
 });
 await t.test('candidate resolution, stale check and restricted identity stay private',async()=>{
  const r=await draft(),i={...r.identity,fullName:'Different person'};
  await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',identity:i}).expect(409);
  const check=(await post('/member-candidates',{branchId:'branch-a',identity:i}).expect(200)).body.data;
  assert.equal(check.candidates[0].memberId,r.memberId);
  const distinct=(await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',identity:i,duplicateResolution:{decision:'distinct_person',reason:'Shared family contact',candidateCheckId:check.candidateCheckId}}).expect(201)).body.data.registration;
  const fresh=(await post('/member-candidates',{branchId:'branch-a',identity:i}).expect(200)).body.data;
  await post(`/registrations/${distinct.id}/submit`,{version:distinct.version,duplicateResolution:{decision:'distinct_person',reason:'Confirmed shared contact',candidateCheckId:fresh.candidateCheckId}}).expect(200);
  const [stored]=await db.select().from(registration).where(eq(registration.id,distinct.id));
  assert.equal(stored!.duplicateResolutions.length,2);assert.equal(stored!.submissions.length,1);
  await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',identity:i,duplicateResolution:{decision:'distinct_person',reason:'Shared family contact',candidateCheckId:check.candidateCheckId}}).expect(409);
  const secret=identity();await db.insert(member).values({id:'hidden-profile',gymId:config.GYM_ID,...secret});await db.insert(memberBranch).values({gymId:config.GYM_ID,memberId:'hidden-profile',branchId:'branch-b'});
  const hidden=(await post('/member-candidates',{branchId:'branch-a',identity:secret}).expect(200)).body.data;
  assert.equal(hidden.restrictedMatch,true);assert.deepEqual(hidden.candidates,[]);
  await a.get('/api/v1/members/hidden-profile?branchId=branch-a').expect(404);
  await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',identity:secret,duplicateResolution:{decision:'distinct_person',reason:'Try bypass',candidateCheckId:hidden.candidateCheckId}}).expect(409);
 });
 await t.test('pagination and replay permission changes',async()=>{
  const first=(await a.get('/api/v1/registrations?branchId=branch-a&limit=1').expect(200)).body.data;
  assert.equal(first.items.length,1);assert.equal(first.items[0].identity,undefined);assert.ok(first.nextCursor);
  const second=(await a.get('/api/v1/registrations').query({branchId:'branch-a',limit:1,cursor:first.nextCursor}).expect(200)).body.data;assert.notEqual(first.items[0].id,second.items[0].id);
  await b.get('/api/v1/registrations').query({branchId:'branch-a',cursor:first.nextCursor}).expect(422);
  await a.get('/api/v1/registrations?branchId=branch-a&cursor=malformed').expect(422);
  await db.delete(branchAccess).where(and(eq(branchAccess.userId,actor),eq(branchAccess.role,'admin')));
  await a.get('/api/v1/registrations?branchId=branch-a').expect(403);
  await post('/registrations',{branchId:'branch-a',planVersionId:'plan-a',identity:identity()},'create-retry').expect(403);
 });
}
