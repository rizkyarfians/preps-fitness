import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TestContext } from 'node:test';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../src/db/client.js';
import type { Config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { registrationRouter } from '../src/registration-api.js';
import { user,gymUser,branchAccess,plan,planVersion,registrationOrder,auditEvent,outboxEvent } from '../src/db/schema.js';
export async function planScenarios(t:TestContext,db:Database,config:Config) {
 const actor='plan-admin',other='plan-owner',memberActor='plan-member';
 await db.insert(user).values([actor,other,memberActor].map(id=>({id,name:id,email:`${id}@example.test`})));
 await db.insert(gymUser).values([actor,other,memberActor].map(userId=>({gymId:config.GYM_ID,userId})));
 await db.insert(branchAccess).values([
  {gymId:config.GYM_ID,branchId:'branch-a',userId:actor,role:'admin'},
  {gymId:config.GYM_ID,branchId:'branch-a',userId:other,role:'owner'},
  {gymId:config.GYM_ID,branchId:'branch-a',userId:memberActor,role:'member'},
 ]);
 const app=(id:string)=>createApp({gymId:config.GYM_ID,webOrigin:config.WEB_ORIGIN,authHandler:(_q,s)=>{s.sendStatus(404);},ready:async()=>{},getBranch:async()=>null,
  resolvePrincipal:async()=>({user:{id,name:id,email:`${id}@example.test`},gymId:config.GYM_ID,enabled:true,grants:[]}),registrationRouter:registrationRouter(db,config)});
 const a=request(app(actor)),b=request(app(other)),m=request(app(memberActor));
 let n=0;
 const write=(method:'post'|'patch',path:string,body:object,key=`plan-key-${++n}`,agent=a)=>agent[method]('/api/v1'+path).set('Origin',config.WEB_ORIGIN).set('Idempotency-Key',key).send(body);
 const content={name:'Operational monthly',price:{amount:'350000.00',currency:'IDR'},duration:{value:1,unit:'month' as const},benefits:['Gym access']};
 await t.test('plan migration backfills existing versions with latest snapshot and branch scope',async()=>{
  // Seed old-style facts after DDL, then exercise the migration's actual data statement.
  for(const branchId of ['branch-a','branch-b'])for(const version of [1,2]){
   const id=`legacy-${branchId}-${version}`;
   await db.insert(planVersion).values({id,gymId:config.GYM_ID,branchId,planId:'legacy-plan',version,snapshot:{...content,name:`Legacy ${version}`,id,planId:'legacy-plan',branchId,version,publishedAt:new Date().toISOString()}});
  }
  const migration=readFileSync('db/migrations/0004_lush_violations.sql','utf8');
  await db.execute(sql.raw(migration.slice(migration.indexOf('INSERT INTO `plan`'))));
  const migrated=await db.select().from(plan).where(eq(plan.id,'legacy-plan'));
  assert.equal(migrated.length,2);assert.ok(migrated.every(p=>p.draft.name==='Legacy 2' && !('id' in p.draft)));
  const p=(await a.get('/api/v1/plans/legacy-plan?branchId=branch-a').expect(200)).body.data;
  const edited=(await write('patch','/plans/legacy-plan?branchId=branch-a',{version:p.version,draft:content}).expect(200)).body.data.plan;
  const published=(await write('post','/plans/legacy-plan/publish?branchId=branch-a',{version:edited.version}).expect(200)).body.data;
  assert.equal(published.publishedVersion.version,3);
 });
 await t.test('draft validation, publishing completeness, authorization, origin and pagination',async()=>{
  await a.post('/api/v1/plans').send({branchId:'branch-a',draft:{}}).expect(403);
  await write('post','/plans',{branchId:'branch-b',draft:{}}).expect(403);
  await write('post','/plans',{branchId:'branch-a',draft:{}},'member-denied',m).expect(403);
  for(const draft of [{price:{amount:350000,currency:'IDR'}},{price:{amount:'1.001',currency:'IDR'}},{name:' '},{duration:{value:0,unit:'month'}},{benefits:['x','x']},{publishedAt:'2026-01-01'}]){
   await write('post','/plans',{branchId:'branch-a',draft}).expect(422);
  }
  let p=(await write('post','/plans',{branchId:'branch-a',draft:{}}).expect(201)).body.data.plan;
  const failed=await write('post',`/plans/${p.id}/publish?branchId=branch-a`,{version:p.version}).expect(422);
  assert.equal(failed.body.error.reasonCode,'VALIDATION_FAILED');
  assert.equal((await db.select().from(planVersion).where(eq(planVersion.planId,p.id))).length,0);
  const audit=await db.select().from(auditEvent).where(and(eq(auditEvent.operation,'plan.publish'),eq(auditEvent.resourceId,p.id)));assert.equal(audit.length,0);
  p=(await write('patch',`/plans/${p.id}?branchId=branch-a`,{version:p.version,draft:content}).expect(200)).body.data.plan;
  await write('patch',`/plans/${p.id}?branchId=branch-a`,{version:1,draft:content}).expect(409);
  await a.get(`/api/v1/plans/${p.id}?branchId=branch-b`).expect(403);
  const page=(await a.get('/api/v1/plans?branchId=branch-a&limit=1').expect(200)).body.data;
  assert.equal(page.items.length,1);assert.ok(page.nextCursor);
  await b.get('/api/v1/plans').query({branchId:'branch-a',cursor:page.nextCursor}).expect(422);
  await a.get('/api/v1/plans').query({branchId:'branch-a',cursor:page.nextCursor}).expect(200);
 });
 await t.test('deactivation preserves submitted snapshots; durable recovery is actor scoped and safe after restart',async()=>{
  const recover=(operation:string,key:string,agent=a,branchId='branch-a')=>agent.post('/api/v1/commands/resolve').set('Origin',config.WEB_ORIGIN).send({branchId,operation,idempotencyKey:key});
  const make=(suffix:string)=>write('post','/plans',{branchId:'branch-a',draft:content},`recover-create-${suffix}`);
  const created=(await make('one').expect(201)).body.data;
  const p=created.plan;
  const pub=(await write('post',`/plans/${p.id}/publish?branchId=branch-a`,{version:p.version},'recover-publish').expect(200)).body.data;
  const offer=pub.publishedVersion;
  // A fresh application instance proves recovery does not depend on process memory.
  const fresh=request(app(actor));
  const recovered=(await recover('plan.create','recover-create-one',fresh).expect(200)).body.data;
  assert.deepEqual(recovered,{status:'completed',commandId:created.commandId,operation:'plan.create',result:{resourceType:'plan',resourceId:p.id}});
  assert.equal((await recover('plan.publish','recover-publish',fresh).expect(200)).body.data.result.planVersionId,offer.id);
  assert.deepEqual((await recover('plan.create','recover-create-one',b).expect(200)).body.data,{status:'unknown'});
  assert.deepEqual((await recover('plan.edit','recover-create-one').expect(200)).body.data,{status:'unknown'});
  await recover('plan.create','recover-create-one',a,'branch-b').expect(403);
  await recover('plan.create','recover-create-one',m).expect(403);
  await a.post('/api/v1/commands/resolve').send({branchId:'branch-a',operation:'plan.create',idempotencyKey:'recover-create-one'}).expect(403);
  await a.post('/api/v1/commands/resolve').set('Origin',config.WEB_ORIGIN).send({branchId:'branch-a',operation:'plan.create',idempotencyKey:'recover-create-one',actorId:other}).expect(422);
  const identity={fullName:'Recovery test member',phone:'+62819999123457',address:'Original address',birthDate:'2000-01-01'};
  const createReg=(name:string,phone:string,key:string)=>write('post','/registrations',{branchId:'branch-a',planVersionId:offer.id,identity:{...identity,fullName:name,phone}},key);
  let pending=(await createReg(identity.fullName,identity.phone,'recover-registration').expect(201)).body.data.registration;
  const draft=(await createReg('Retired draft','+62819999123458','retired-draft').expect(201)).body.data.registration;
  pending=(await write('patch',`/registrations/${pending.id}`,{version:pending.version,planVersionId:offer.id,identity:{...identity,address:'Corrected address'}},'recover-edit').expect(200)).body.data.registration;
  pending=(await write('post',`/registrations/${pending.id}/submit`,{version:pending.version},'recover-submit').expect(200)).body.data.registration;
  const retirePath=`/plan-versions/${offer.id}/deactivate?branchId=branch-a`;
  await write('post',retirePath,{},'denied-retire',m).expect(403);
  await write('post',retirePath,{selectable:true}).expect(422);
  await write('post',`/plan-versions/${offer.id}/deactivate?branchId=branch-b`,{}).expect(403);
  await write('post','/plan-versions/absent/deactivate?branchId=branch-a',{}).expect(404);
  const race=await Promise.all([write('post',retirePath,{},'retire-once'),write('post',retirePath,{},'retire-once')]);
  assert.ok(race.every(r=>r.status===200));assert.equal(new Set(race.map(r=>r.body.data.commandId)).size,1);
  assert.equal(race.filter(r=>!r.body.data.replayed).length,1);
  assert.equal((await write('post',retirePath,{},'another-retire').expect(409)).body.error.reasonCode,'PLAN_ALREADY_INACTIVE');
  await write('post',`/plan-versions/${draft.id}/deactivate?branchId=branch-a`,{},'retire-once').expect(409);
  const history=(await a.get(`/api/v1/plans/${p.id}/versions?branchId=branch-a`).expect(200)).body.data.items;
  assert.deepEqual(history,[{offer,selectable:false}]);
  assert.ok(!(await a.get('/api/v1/plan-versions?branchId=branch-a').expect(200)).body.data.items.some((v:{id:string})=>v.id===offer.id));
  await a.get(`/api/v1/plan-versions/${offer.id}?branchId=branch-a`).expect(409);
  await createReg('Unavailable offer','+62819999123459','unavailable-create').expect(409);
  await write('post',`/registrations/${draft.id}/submit`,{version:draft.version},'unavailable-submit').expect(409);
  await write('patch',`/registrations/${draft.id}`,{version:draft.version,planVersionId:offer.id}).expect(409);
  // Existing pending review retains the commercial snapshot and can still be approved.
  const reviewBody={version:pending.version,decision:'approve'};
  const approved=(await write('post',`/registrations/${pending.id}/review`,reviewBody,'recover-approve').expect(200)).body.data;
  await write('post',`/registrations/${pending.id}/review`,reviewBody,'recover-approve').expect(200);
  for(const [operation,key] of [['registration.create','recover-registration'],['registration.edit','recover-edit'],['registration.submit','recover-submit'],['registration.review','recover-approve']]) {
   const r=(await recover(operation!,key!,fresh).expect(200)).body.data;
   assert.equal(r.status,'completed');assert.deepEqual(r.result,{resourceType:'registration',resourceId:pending.id});
   assert.ok(!JSON.stringify(r).includes(identity.phone));
  }
  const [order]=await db.select().from(registrationOrder).where(eq(registrationOrder.registrationId,pending.id));
  assert.equal(order!.id,approved.registration.orderId);assert.deepEqual(order!.offer,offer);
  assert.equal((await db.select().from(registrationOrder).where(eq(registrationOrder.registrationId,pending.id))).length,1);
  const retired=(await recover('plan-version.deactivate','retire-once',fresh).expect(200)).body.data;
  assert.deepEqual(retired.result,{resourceType:'plan',resourceId:p.id,planVersionId:offer.id});
  const audits=await db.select().from(auditEvent).where(eq(auditEvent.commandId,retired.commandId));assert.equal(audits.length,1);
  assert.equal((await db.select().from(outboxEvent).where(eq(outboxEvent.commandId,retired.commandId))).length,1);
  // Absence is explicitly unknown: a delayed write can still complete afterward.
  assert.deepEqual((await recover('plan.create','recover-create-late').expect(200)).body.data,{status:'unknown'});
  await make('late').expect(201);
  assert.equal((await recover('plan.create','recover-create-late').expect(200)).body.data.status,'completed');
  assert.deepEqual((await recover('registration.create','unavailable-create').expect(200)).body.data,{status:'unknown'});
  await db.update(gymUser).set({enabled:false}).where(and(eq(gymUser.gymId,config.GYM_ID),eq(gymUser.userId,actor)));
  try {await recover('plan.create','recover-create-one',fresh).expect(403);} finally {
   await db.update(gymUser).set({enabled:true}).where(and(eq(gymUser.gymId,config.GYM_ID),eq(gymUser.userId,actor)));
  }
  await db.update(branchAccess).set({role:'member'}).where(and(eq(branchAccess.gymId,config.GYM_ID),eq(branchAccess.userId,actor)));
  try {await recover('plan.create','recover-create-one',fresh).expect(403);} finally {
   await db.update(branchAccess).set({role:'admin'}).where(and(eq(branchAccess.gymId,config.GYM_ID),eq(branchAccess.userId,actor)));
  }
 });
 await t.test('publish retries and two-admin race produce exactly one immutable version with audit/outbox',async()=>{
  const body={branchId:'branch-a',draft:content};
  const created=await Promise.all(Array.from({length:4},()=>write('post','/plans',body,'create-plan-once')));
  assert.ok(created.every(r=>[200,201].includes(r.status)));assert.equal(new Set(created.map(r=>r.body.data.plan.id)).size,1);
  const p=created[0]!.body.data.plan,path=`/plans/${p.id}/publish?branchId=branch-a`;
  const race=await Promise.all([write('post',path,{version:1},'publish-admin'),write('post',path,{version:1},'publish-owner',b)]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const winner=race[0]!.status===200?0:1,key=winner===0?'publish-admin':'publish-owner',agent=winner===0?a:b;
  const published=race[winner]!.body.data.publishedVersion;
  const replay=(await write('post',path,{version:1},key,agent).expect(200)).body.data;
  assert.equal(replay.replayed,true);assert.equal(replay.publishedVersion.id,published.id);
  await write('post',path,{version:2},key,agent).expect(409);
  await write('post',path,{version:2}).expect(409);
  const versions=await db.select().from(planVersion).where(eq(planVersion.planId,p.id));assert.equal(versions.length,1);
  const audits=await db.select().from(auditEvent).where(eq(auditEvent.resourceId,published.id));assert.equal(audits.length,1);
  assert.equal((await db.select().from(outboxEvent).where(eq(outboxEvent.commandId,audits[0]!.commandId))).length,1);
  let r=(await write('post','/registrations',{branchId:'branch-a',planVersionId:published.id,identity:{fullName:'Plan snapshot test',phone:'+62819999123456',address:'Test address',birthDate:'2000-01-01'}}).expect(201)).body.data.registration;
  r=(await write('post',`/registrations/${r.id}/submit`,{version:r.version}).expect(200)).body.data.registration;
  const updated=(await write('patch',`/plans/${p.id}?branchId=branch-a`,{version:2,draft:{...content,price:{amount:'450000.00',currency:'IDR'}}}).expect(200)).body.data.plan;
  const v2=(await write('post',path,{version:updated.version}).expect(200)).body.data.publishedVersion;
  assert.equal(v2.version,2);assert.notEqual(v2.id,published.id);
  assert.equal((await write('post',path,{version:1},key,agent).expect(200)).body.data.publishedVersion.id,published.id);
  const old=(await a.get(`/api/v1/plan-versions/${published.id}?branchId=branch-a`).expect(200)).body.data;assert.equal(old.price.amount,'350000.00');
  const history=(await a.get(`/api/v1/plans/${p.id}/versions?branchId=branch-a`).expect(200)).body.data;assert.equal(history.items.length,2);
  r=(await write('post',`/registrations/${r.id}/review`,{version:r.version,decision:'approve'}).expect(200)).body.data.registration;
  const [order]=await db.select().from(registrationOrder).where(eq(registrationOrder.id,r.orderId));assert.equal(order!.offer.price.amount,'350000.00');
  await db.update(gymUser).set({enabled:false}).where(and(eq(gymUser.gymId,config.GYM_ID),eq(gymUser.userId,winner===0?actor:other)));
  await write('post',path,{version:1},key,agent).expect(403);
 });
}
