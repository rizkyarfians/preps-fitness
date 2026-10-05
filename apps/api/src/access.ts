export type Role = 'owner' | 'admin' | 'pt' | 'member';
export interface Grant { gymId: string; branchId: string; role: Role }
export interface Principal { user: { id: string; name: string; email: string }; gymId: string; enabled: boolean; grants: Grant[] }
export function allowedBranch(p: Principal, deploymentGym: string, branchId: string): boolean {
 return p.enabled && p.gymId === deploymentGym && p.grants.some(g => g.gymId === deploymentGym && g.branchId === branchId);
}
