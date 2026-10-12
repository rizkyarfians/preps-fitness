import { z } from 'zod';
import { identifier, offerSchema } from './registration-validation.js';
// Drafts can omit whole fields, but supplied values must already be well formed.
export const planContentSchema = offerSchema.pick({ name:true,price:true,duration:true,benefits:true }).extend({
 duration:z.object({value:z.number().int().min(1).max(2147483647),unit:z.enum(['day','month'])}).strict(),
 benefits:z.array(z.string().trim().min(1).max(100)).max(100).refine(v=>new Set(v).size===v.length,'Duplicate benefits'),
}).strict();
export const planDraftSchema = planContentSchema.partial();
export type PlanDraftContent = z.infer<typeof planDraftSchema>;
export const createPlanSchema = z.object({branchId:identifier,draft:planDraftSchema}).strict();
export const planRevisionSchema = z.number().int().min(1).max(2147483646);
export const editPlanSchema = z.object({version:planRevisionSchema,draft:planDraftSchema}).strict();
export const publishPlanSchema = z.object({version:planRevisionSchema}).strict();
