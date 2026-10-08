import { z } from 'zod';
export const identifier = z.string().min(1).max(36);
const text = (max: number) => z.string().trim().min(1).max(max);
export const identitySchema = z.object({
 fullName: text(200), phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/), address: text(1000),
 birthPlace: text(120).optional(), email: z.string().trim().email().max(254).optional(),
 birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return v >= '1000-01-01' && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v;
 }, 'INVALID_DATE'),
}).strict();
export type Identity = z.infer<typeof identitySchema>;
export interface Offer { id: string; planId: string; version: number; branchId: string; name: string; publishedAt: string; price: { amount: string; currency: string }; duration: { value: number; unit: 'day' | 'month' }; benefits: string[] }
export interface ReviewEvent { decision: 'approve' | 'reject' | 'clarify'; actorId: string; reason: string; at: string; version: number }
export const offerSchema = z.object({ id:identifier, planId:identifier, version:z.number().int().positive(), branchId:identifier,
 name:text(200), publishedAt:z.string().datetime(), price:z.object({ amount:z.string().regex(/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/),currency:z.string().regex(/^[A-Z]{3}$/) }).strict(),
 duration:z.object({ value:z.number().int().positive(),unit:z.enum(['day','month']) }).strict(),benefits:z.array(text(100)) }).strict();
export function todayIn(timezone: string, now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-US', { timeZone:timezone, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
 return ['year','month','day'].map(k => parts.find(p => p.type === k)!.value).join('-');
}
export function completeIdentity(value: unknown, timezone: string): value is Identity {
 const r = identitySchema.safeParse(value); return r.success && r.data.birthDate <= todayIn(timezone);
}
export const resolutionSchema = z.object({ decision:z.literal('distinct_person'),reason:text(1000),candidateCheckId:identifier }).strict();
const common = { branchId:identifier,planVersionId:identifier };
export const createSchema = z.union([
 z.object({ ...common,identity:identitySchema,duplicateResolution:resolutionSchema.optional() }).strict(),
 z.object({ ...common,memberId:identifier }).strict(),
]);
export const editSchema = z.object({ version:z.number().int().positive(),planVersionId:identifier,identity:identitySchema.optional() }).strict();
export const submitSchema = z.object({ version:z.number().int().positive(),duplicateResolution:resolutionSchema.optional() }).strict();
export const reviewSchema = z.object({ decision:z.enum(['approve','reject','clarify']),version:z.number().int().positive(),reason:text(1000).optional() }).strict().refine(v => v.decision === 'approve' || !!v.reason, { path:['reason'],message:'REQUIRED' });
export type Resolution = z.infer<typeof resolutionSchema>;
export class RegistrationError extends Error {
 constructor(public status:number, public reasonCode:string, public details: { currentVersion?:number;fieldErrors?:{field:string;code:string}[] } = {}) { super(reasonCode); }
}
export function validateIdentity(value: Identity, timezone: string) {
 if (value.birthDate > todayIn(timezone)) throw new RegistrationError(422,'VALIDATION_FAILED',{ fieldErrors:[{field:'identity.birthDate',code:'FUTURE_DATE'}] });
}
export function actions(status:string) { return status === 'draft' || status === 'needs_clarification' ? ['edit','submit'] : status === 'pending_review' ? ['approve','reject','clarify'] : []; }
