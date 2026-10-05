import { allowedBranch, type Principal } from './access.js';
export const benefits = ['tutorial.view', 'personal.training'] as const;
export type Benefit = typeof benefits[number];
/** Read-only facts supplied by trusted domain repositories, never a request body. */
export interface BenefitFacts {
 gymId: string; userId: string;
 capabilities: readonly Benefit[];
 grants: readonly {
  benefit: Benefit; branchId: string;
  status: 'upcoming' | 'active' | 'frozen' | 'expired' | 'cancelled';
  validFrom: Date; validUntil: Date; revoked: boolean;
 }[];
}
export type BenefitReason = 'ALLOWED' | 'ACCOUNT_ACCESS_DENIED' | 'BRANCH_ACCESS_DENIED' | 'UNKNOWN_BENEFIT' | 'BENEFIT_SOURCE_NOT_READY' | 'CAPABILITY_DISABLED' | 'MEMBER_BENEFIT_REQUIRED';
export interface BenefitDecision { allowed: boolean; reasonCode: BenefitReason }
export function evaluateBenefit(input: {
 principal: Principal; deploymentGym: string; branchId: string;
 benefit: string; facts: BenefitFacts | null; asOf: Date;
}): BenefitDecision {
 const { principal: p, deploymentGym, branchId, benefit, facts, asOf } = input;
 const deny = (reasonCode: BenefitReason): BenefitDecision => ({ allowed: false, reasonCode });
 if (!p.enabled || p.gymId !== deploymentGym) return deny('ACCOUNT_ACCESS_DENIED');
 if (!allowedBranch(p, deploymentGym, branchId)) return deny('BRANCH_ACCESS_DENIED');
 if (!benefits.includes(benefit as Benefit)) return deny('UNKNOWN_BENEFIT');
 if (!facts || facts.gymId !== deploymentGym || facts.userId !== p.user.id || !Number.isFinite(asOf.getTime())) return deny('BENEFIT_SOURCE_NOT_READY');
 if (!facts.capabilities.includes(benefit as Benefit)) return deny('CAPABILITY_DISABLED');
 const active = facts.grants.some(g => g.benefit === benefit && g.branchId === branchId && g.status === 'active' && !g.revoked
  && g.validFrom.getTime() <= asOf.getTime() && asOf.getTime() < g.validUntil.getTime());
 return active ? { allowed: true, reasonCode: 'ALLOWED' } : deny('MEMBER_BENEFIT_REQUIRED');
}
