import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, or, inArray, asc, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './db/client.js';
import type { Config } from './config.js';
import type { Principal } from './access.js';
import { createCommandRunner, CommandError, canonicalJson, type Transaction, type JsonValue } from './commands.js';
import { member, memberBranch, branchAccess, planVersion, registration, registrationOrder, candidateCheck } from './db/schema.js';
import { identifier, identitySchema, createSchema, editSchema, submitSchema, reviewSchema, todayIn, completeIdentity, validateIdentity, actions, RegistrationError, type Identity, type Resolution, type Offer } from './registration-validation.js';
type Executor = Database | Transaction;
type Row = typeof registration.$inferSelect;
const profileIdentity = (m: typeof member.$inferSelect): Partial<Identity> => Object.fromEntries(
 ['fullName','phone','address','birthPlace','birthDate','email'].flatMap(k => {
  const value = m[k as keyof typeof m]; return typeof value === 'string' && value ? [[k,value]] : [];
 }));
const asyncRoute = (fn:(req:Request,res:Response)=>Promise<void>) => (req:Request,res:Response,next:NextFunction) => { void fn(req,res).catch(next); };
export function registrationRouter(db:Database, config:Config) {
 const router = Router();
 const run = createCommandRunner(db,config.GYM_ID);
 const hash = (value: unknown) => createHmac('sha256',config.BETTER_AUTH_SECRET).update(canonicalJson(JSON.parse(JSON.stringify(value)) as JsonValue)).digest('hex');
 const principal = (res:Response) => res.locals.principal as Principal;
 const parse = <T>(schema:z.ZodType<T>, value:unknown):T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new RegistrationError(422,'VALIDATION_FAILED',{fieldErrors:r.error.issues.map(i=>({field:i.path.join('.') || 'body',code:i.message==='INVALID_DATE'?'INVALID_DATE':i.message==='REQUIRED'?'REQUIRED':i.code==='too_big'?'TOO_LONG':i.code==='unrecognized_keys'?'UNKNOWN_FIELD':'INVALID_FORMAT'}))});
  return r.data;
 };
 async function grants(tx:Executor, actor:string) {
  return tx.select().from(branchAccess).where(and(eq(branchAccess.gymId,config.GYM_ID),eq(branchAccess.userId,actor),inArray(branchAccess.role,['owner','admin'])));
 }
 async function authorize(tx:Executor, actor:string, branchId:string) {
  if (!(await grants(tx,actor)).some(g=>g.branchId===branchId)) throw new RegistrationError(403,'ACTION_NOT_ALLOWED');
 }
 async function visible(tx:Executor, actor:string, m:typeof member.$inferSelect) {
  const allowed = (await grants(tx,actor)).map(g=>g.branchId);
  if (!allowed.length) return false;
  const links = await tx.select().from(memberBranch).where(and(eq(memberBranch.gymId,config.GYM_ID),eq(memberBranch.memberId,m.id),inArray(memberBranch.branchId,allowed)));
  if (links.length) return true;
  if (!m.userId) return false;
  const linked = await tx.select().from(branchAccess).where(and(eq(branchAccess.gymId,config.GYM_ID),eq(branchAccess.userId,m.userId),inArray(branchAccess.branchId,allowed)));
  return linked.length>0;
 }
 async function findMember(tx:Executor, actor:string, id:string) {
  const [m]=await tx.select().from(member).where(and(eq(member.gymId,config.GYM_ID),eq(member.id,id)));
  if (!m || !await visible(tx,actor,m)) throw new RegistrationError(404,'NOT_FOUND');
  return m;
 }
 async function offer(tx:Executor, branchId:string, id:string):Promise<Offer> {
  const [p]=await tx.select().from(planVersion).where(and(eq(planVersion.gymId,config.GYM_ID),eq(planVersion.branchId,branchId),eq(planVersion.id,id),eq(planVersion.selectable,true)));
  if (!p) throw new RegistrationError(409,'PLAN_UNAVAILABLE'); return p.snapshot;
 }
 async function get(tx:Executor, actor:string, id:string) {
  const [r]=await tx.select().from(registration).where(and(eq(registration.gymId,config.GYM_ID),eq(registration.id,id)));
  if (!r) throw new RegistrationError(404,'NOT_FOUND');
  await authorize(tx,actor,r.branchId); return r;
 }
 const detail = (r:Row) => ({ id:r.id,branchId:r.branchId,memberId:r.memberId,identity:r.identity,profileComplete:completeIdentity(r.identity,config.GYM_TIMEZONE),status:r.status,version:r.version,offer:r.offer,createdBy:r.createdBy,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString(),allowedActions:actions(r.status),history:r.history,...(r.orderId?{orderId:r.orderId}:{}) });
 async function candidates(tx:Executor, actor:string, identity:Identity, exclude?:string) {
  const matches=await tx.select().from(member).where(and(eq(member.gymId,config.GYM_ID),or(eq(member.phone,identity.phone),identity.email?eq(member.email,identity.email):undefined,and(eq(member.fullName,identity.fullName),eq(member.birthDate,identity.birthDate)))));
  // Include corrected registration snapshots without overwriting shared member profiles.
  const snapshots = await tx.select({memberId:registration.memberId,identity:registration.identity}).from(registration).where(and(eq(registration.gymId,config.GYM_ID),or(
   sql`JSON_UNQUOTE(JSON_EXTRACT(${registration.identity}, '$.phone')) = ${identity.phone}`,
   identity.email ? sql`LOWER(JSON_UNQUOTE(JSON_EXTRACT(${registration.identity}, '$.email'))) = ${identity.email.toLowerCase()}` : undefined,
   sql`LOWER(JSON_UNQUOTE(JSON_EXTRACT(${registration.identity}, '$.fullName'))) = ${identity.fullName.toLowerCase()} AND JSON_UNQUOTE(JSON_EXTRACT(${registration.identity}, '$.birthDate')) = ${identity.birthDate}`)));
  for (const snapshot of snapshots) {
   if(matches.some(m=>m.id===snapshot.memberId))continue;
   const [m]=await tx.select().from(member).where(and(eq(member.gymId,config.GYM_ID),eq(member.id,snapshot.memberId)));
   if(m)matches.push({...m,...snapshot.identity});
  }
  const publicMatches:{memberId:string;displayName:string;matchReasons:string[]}[]=[];
  const ids:string[]=[]; let restricted=false;
  for(const m of matches) {
   if(m.id===exclude)continue; ids.push(m.id);
   if(!await visible(tx,actor,m)) { restricted=true;continue; }
   const reasons=[];
   if(m.phone===identity.phone)reasons.push('phone');
   if(identity.email && m.email?.toLowerCase()===identity.email.toLowerCase())reasons.push('email');
   if(m.fullName?.toLowerCase()===identity.fullName.toLowerCase() && m.birthDate===identity.birthDate)reasons.push('name_birth_date');
   publicMatches.push({memberId:m.id,displayName:m.fullName || 'Member',matchReasons:reasons});
  }
  return {ids:ids.sort(),restricted,publicMatches};
 }
 async function duplicateGuard(tx:Transaction, actor:string, branchId:string, identity:Identity, resolution?:Resolution, exclude?:string) {
  const all=await candidates(tx,actor,identity);
  const c=await candidates(tx,actor,identity,exclude);
  if(!c.ids.length)return;
  if(c.restricted || !resolution)throw new RegistrationError(409,'DUPLICATE_REVIEW_REQUIRED');
  const [check]=await tx.select().from(candidateCheck).where(and(eq(candidateCheck.id,resolution.candidateCheckId),eq(candidateCheck.gymId,config.GYM_ID),eq(candidateCheck.actorId,actor),eq(candidateCheck.branchId,branchId)));
  if(!check || check.expiresAt<=new Date() || check.identityHash!==hash(identity) || check.candidatesHash!==hash(all.ids))throw new RegistrationError(409,'DUPLICATE_CHECK_STALE');
 }
 // Cursor integrity and scope prevent cross-user/filter reuse; no personal data in cursor.
 function pageArgs(req:Request, actor:string, scope:unknown) {
  const limit=parse(z.coerce.number().int().min(1).max(100).default(25),req.query.limit);
  let after:string|undefined;
  if(req.query.cursor!==undefined) {
   const token=parse(z.string().max(512),req.query.cursor);const [raw,mac]=token.split('.');
   if(!raw || !mac || !/^[a-f0-9]{64}$/.test(mac) || !timingSafeEqual(Buffer.from(hash(raw)),Buffer.from(mac)))throw new RegistrationError(422,'VALIDATION_FAILED');
   try {const decoded=JSON.parse(Buffer.from(raw,'base64url').toString());if(decoded.scope!==hash([actor,scope]))throw new Error();after=identifier.parse(decoded.after);}catch{throw new RegistrationError(422,'VALIDATION_FAILED');}
  }
  return {limit,after,cursor:(id:string)=>{const raw=Buffer.from(JSON.stringify({after:id,scope:hash([actor,scope])})).toString('base64url');return `${raw}.${hash(raw)}`;}};
 }
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method) && req.get('origin')!==config.WEB_ORIGIN) { next(new RegistrationError(403,'ACTION_NOT_ALLOWED'));return; }
  next();
 });
 router.get('/registration-context',asyncRoute(async(req,res)=>{
  const branchId=parse(identifier,req.query.branchId);await authorize(db,principal(res).user.id,branchId);
  res.json({data:{gymId:config.GYM_ID,branchId,timezone:config.GYM_TIMEZONE,today:todayIn(config.GYM_TIMEZONE),asOf:new Date().toISOString(),allowedActions:['create']}});
 }));
 router.get('/plan-versions',asyncRoute(async(req,res)=>{
  const actor=principal(res).user.id;const branchId=parse(identifier,req.query.branchId);await authorize(db,actor,branchId);
  const p=pageArgs(req,actor,['plans',branchId]);
  const rows=await db.select().from(planVersion).where(and(eq(planVersion.gymId,config.GYM_ID),eq(planVersion.branchId,branchId),eq(planVersion.selectable,true),p.after?gt(planVersion.id,p.after):undefined)).orderBy(asc(planVersion.id)).limit(p.limit+1);
  const more=rows.length>p.limit;const list=rows.slice(0,p.limit);res.json({data:{items:list.map(r=>r.snapshot),...(more?{nextCursor:p.cursor(list.at(-1)!.id)}:{})}});
 }));
 router.get('/plan-versions/:id',asyncRoute(async(req,res)=>{
  const branchId=parse(identifier,req.query.branchId);await authorize(db,principal(res).user.id,branchId);res.json({data:await offer(db,branchId,parse(identifier,req.params.id))});
 }));
 router.get('/members/:id',asyncRoute(async(req,res)=>{
  const actor=principal(res).user.id;await authorize(db,actor,parse(identifier,req.query.branchId));const m=await findMember(db,actor,parse(identifier,req.params.id));
  const identity=profileIdentity(m);res.json({data:{id:m.id,identity,profileComplete:completeIdentity(identity,config.GYM_TIMEZONE),accountLinked:!!m.userId}});
 }));
 router.post('/member-candidates',asyncRoute(async(req,res)=>{
  const body=parse(z.object({branchId:identifier,identity:identitySchema}).strict(),req.body);const actor=principal(res).user.id;
  await authorize(db,actor,body.branchId);validateIdentity(body.identity,config.GYM_TIMEZONE);
  const c=await candidates(db,actor,body.identity);const id=randomUUID(),expiresAt=new Date(Date.now()+600000);
  await db.insert(candidateCheck).values({id,gymId:config.GYM_ID,actorId:actor,branchId:body.branchId,identityHash:hash(body.identity),candidatesHash:hash(c.ids),expiresAt});
  res.json({data:{candidateCheckId:id,expiresAt:expiresAt.toISOString(),restrictedMatch:c.restricted,candidates:c.publicMatches}});
 }));
 router.get('/registrations',asyncRoute(async(req,res)=>{
  const actor=principal(res).user.id,branchId=parse(identifier,req.query.branchId);await authorize(db,actor,branchId);
  const status=parse(z.enum(['draft','pending_review','needs_clarification','approved','rejected']).optional(),req.query.status);
  const search=parse(z.string().trim().max(200).optional(),req.query.search);
  const p=pageArgs(req,actor,['registrations',branchId,status||'',search||'']);
  const rows=await db.select().from(registration).where(and(eq(registration.gymId,config.GYM_ID),eq(registration.branchId,branchId),status?eq(registration.status,status):undefined,p.after?gt(registration.id,p.after):undefined,search?sql`LOCATE(${search}, JSON_UNQUOTE(JSON_EXTRACT(${registration.identity}, '$.fullName'))) > 0`:undefined)).orderBy(asc(registration.id)).limit(p.limit+1);
  const list=rows.slice(0,p.limit);res.json({data:{items:list.map(r=>({id:r.id,branchId:r.branchId,memberId:r.memberId,fullName:r.identity.fullName||'Member',status:r.status,version:r.version,planName:r.offer.name,createdAt:r.createdAt.toISOString(),allowedActions:actions(r.status)})),...(rows.length>p.limit?{nextCursor:p.cursor(list.at(-1)!.id)}:{})}});
 }));
 router.get('/registrations/:id',asyncRoute(async(req,res)=>{res.json({data:detail(await get(db,principal(res).user.id,parse(identifier,req.params.id)))});}));
 async function command(req:Request,res:Response,branchId:string,operation:string,payload:unknown,execute:(tx:Transaction)=>Promise<string>,created=false) {
  const actor=principal(res).user.id;
  const key=parse(z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),req.get('Idempotency-Key'));
  const result=await run({actorId:actor,branchId,operation,idempotencyKey:key,payload:JSON.parse(JSON.stringify(payload)) as JsonValue},{
   serializeGym:true,authorize:tx=>authorize(tx,actor,branchId),execute:async tx=>{
    const id=await execute(tx);return {result:{id},resourceId:id,events:[operation]};
   },
  });
  const id=(result.result as {id:string}).id;
  res.status(created && !result.replayed?201:200).json({data:{commandId:result.commandId,replayed:result.replayed,registration:detail(await get(db,actor,id))}});
 }
 router.post('/registrations',asyncRoute(async(req,res)=>{
  const body=parse(createSchema,req.body),actor=principal(res).user.id;await authorize(db,actor,body.branchId);
  await command(req,res,body.branchId,'registration.create',body,async tx=>{
   const selected=await offer(tx,body.branchId,body.planVersionId);const isNew='identity' in body;
   let memberId:string;let identity:Partial<Identity>;
   if(isNew) {
    identity=body.identity;validateIdentity(body.identity,config.GYM_TIMEZONE);await duplicateGuard(tx,actor,body.branchId,body.identity,body.duplicateResolution);
    memberId=randomUUID();await tx.insert(member).values({id:memberId,gymId:config.GYM_ID,...body.identity});
   } else {const m=await findMember(tx,actor,body.memberId);memberId=m.id;identity=profileIdentity(m);}
   await tx.insert(memberBranch).values({gymId:config.GYM_ID,branchId:body.branchId,memberId}).onDuplicateKeyUpdate({set:{memberId}});
   const id=randomUUID();await tx.insert(registration).values({id,gymId:config.GYM_ID,branchId:body.branchId,memberId,newMember:isNew,identity,offer:selected,history:[],submissions:[],duplicateResolutions:isNew && body.duplicateResolution?[{...body.duplicateResolution,actorId:actor,at:new Date().toISOString()}]:[],createdBy:actor});return id;
  },true);
 }));
 async function mutate(req:Request,res:Response,kind:'edit'|'submit'|'review') {
  const actor=principal(res).user.id,id=parse(identifier,req.params.id),current=await get(db,actor,id);
  const body=kind==='edit'?parse(editSchema,req.body):kind==='submit'?parse(submitSchema,req.body):parse(reviewSchema,req.body);
  await command(req,res,current.branchId,`registration.${kind}`,{id,...body},async tx=>{
   const r=await get(tx,actor,id);
   if(r.version!==body.version)throw new RegistrationError(409,'STALE_VERSION',{currentVersion:r.version});
   if(kind==='edit') {
    if(!['draft','needs_clarification'].includes(r.status))throw new RegistrationError(409,'INVALID_TRANSITION');
    const edit=body as z.infer<typeof editSchema>;if(edit.identity)validateIdentity(edit.identity,config.GYM_TIMEZONE);
    await tx.update(registration).set({identity:edit.identity||r.identity,offer:await offer(tx,r.branchId,edit.planVersionId),version:r.version+1}).where(eq(registration.id,id));
   } else if(kind==='submit') {
    if(!['draft','needs_clarification'].includes(r.status))throw new RegistrationError(409,'INVALID_TRANSITION');
    if(!completeIdentity(r.identity,config.GYM_TIMEZONE))throw new RegistrationError(422,'PROFILE_INCOMPLETE');
    const other=await tx.select({id:registration.id}).from(registration).where(and(eq(registration.gymId,config.GYM_ID),eq(registration.branchId,r.branchId),eq(registration.pendingMemberId,r.memberId)));
    if(other.some(x=>x.id!==id))throw new RegistrationError(409,'EXISTING_REGISTRATION');
    if(r.newMember) await duplicateGuard(tx,actor,r.branchId,r.identity,(body as z.infer<typeof submitSchema>).duplicateResolution,r.memberId);
    const selected=await offer(tx,r.branchId,r.offer.id);
    await tx.update(registration).set({status:'pending_review',pendingMemberId:r.memberId,offer:selected,version:r.version+1,submissions:[...r.submissions,{identity:r.identity,offer:selected,version:r.version+1,actorId:actor,at:new Date().toISOString()}],duplicateResolutions:[...r.duplicateResolutions,...((body as z.infer<typeof submitSchema>).duplicateResolution?[{...(body as z.infer<typeof submitSchema>).duplicateResolution!,actorId:actor,at:new Date().toISOString()}]:[])]}).where(eq(registration.id,id));
   } else {
    if(r.status!=='pending_review')throw new RegistrationError(409,'INVALID_TRANSITION');
    const review=body as z.infer<typeof reviewSchema>;const status=review.decision==='approve'?'approved':review.decision==='reject'?'rejected':'needs_clarification';
    let orderId:string|undefined;
    if(status==='approved') {orderId=randomUUID();await tx.insert(registrationOrder).values({id:orderId,gymId:config.GYM_ID,registrationId:id,offer:r.offer});}
    await tx.update(registration).set({status,orderId:orderId||null,pendingMemberId:status==='needs_clarification'?r.memberId:null,version:r.version+1,history:[...r.history,{decision:review.decision,reason:review.reason||'',actorId:actor,at:new Date().toISOString(),version:r.version+1}]}).where(eq(registration.id,id));
   }
   return id;
  });
 }
 router.patch('/registrations/:id',asyncRoute((req,res)=>mutate(req,res,'edit')));
 router.post('/registrations/:id/submit',asyncRoute((req,res)=>mutate(req,res,'submit')));
 router.post('/registrations/:id/review',asyncRoute((req,res)=>mutate(req,res,'review')));
 router.use((err:unknown,_req:Request,res:Response,next:NextFunction)=>{
  if(err instanceof CommandError)err=new RegistrationError(err.reasonCode==='COMMAND_ACCESS_DENIED'?403:409,err.reasonCode==='COMMAND_ACCESS_DENIED'?'ACTION_NOT_ALLOWED':err.reasonCode==='COMMAND_INCOMPLETE'?'COMMAND_IN_PROGRESS':err.reasonCode);
  if(err instanceof RegistrationError) {res.status(err.status).json({error:{reasonCode:err.reasonCode,requestId:res.locals.requestId,retryable:err.reasonCode==='COMMAND_IN_PROGRESS',...err.details}});return;}
  next(err);
 });
 return router;
}
