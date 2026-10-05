import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './db/client.js';
import { auditEvent, branchAccess, commandReceipt, gymUser, outboxEvent } from './db/schema.js';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export class CommandError extends Error {
 constructor(public readonly reasonCode: 'COMMAND_ACCESS_DENIED' | 'IDEMPOTENCY_CONFLICT' | 'COMMAND_INCOMPLETE') { super(reasonCode); }
}
// Key sorting avoids false conflicts when object property order changes.
export function canonicalJson(value: JsonValue): string {
 if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
 if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
 if (Array.isArray(value)) {
  for (let i = 0; i < value.length; i++) if (!(i in value)) throw new TypeError('Sparse arrays are not JSON');
  return '[' + value.map(canonicalJson).join(',') + ']';
 }
 if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k]!)).join(',') + '}';
 }
 throw new TypeError('Only finite JSON values are supported');
}
const digest = (v: JsonValue) => createHash('sha256').update(canonicalJson(v)).digest('hex');
const label = z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
const inputSchema = z.object({
 actorId: z.string().min(1).max(36), branchId: z.string().min(1).max(36), operation: label,
 idempotencyKey: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
});
export interface CommandRequest {
 actorId: string; branchId: string; operation: string; idempotencyKey: string; payload: JsonValue;
}
export interface CommandWork {
 /** Must check current operation-specific permissions using this transaction, including on replay. */
 authorize(tx: Transaction): Promise<void>;
 /** Database-only effects. No HTTP/email/provider calls; throw to roll everything back. */
 execute(tx: Transaction, payload: JsonValue): Promise<{ result: JsonValue; resourceId: string; events: string[] }>;
}
/** deploymentGym is trusted server configuration; actorId comes from authenticated session. */
export function createCommandRunner(db: Database, deploymentGym: string) {
 if (!deploymentGym || deploymentGym.length > 36) throw new Error('Invalid deployment gym');
 return async (request: CommandRequest, work: CommandWork) => {
  const input = inputSchema.parse(request);
  const payload: JsonValue = JSON.parse(canonicalJson(request.payload));
  const requestHash = digest(payload);
  const scopeHash = digest([deploymentGym, input.actorId, input.branchId, input.operation, input.idempotencyKey]);
  return db.transaction(async tx => {
   // Serialize account revocation and permission edits against in-flight commands.
   const [account] = await tx.select().from(gymUser).where(and(eq(gymUser.gymId, deploymentGym), eq(gymUser.userId, input.actorId))).for('update');
   if (!account?.enabled) throw new CommandError('COMMAND_ACCESS_DENIED');
   const grants = await tx.select().from(branchAccess).where(and(eq(branchAccess.gymId, deploymentGym), eq(branchAccess.userId, input.actorId), eq(branchAccess.branchId, input.branchId))).for('update');
   if (!grants.length) throw new CommandError('COMMAND_ACCESS_DENIED');
   await work.authorize(tx);
   await tx.insert(commandReceipt).values({ scopeHash, commandId: randomUUID(), gymId: deploymentGym, actorId: input.actorId, branchId: input.branchId,
    operation: input.operation, requestHash, status: 'pending' }).onDuplicateKeyUpdate({ set: { scopeHash: sql`${commandReceipt.scopeHash}` } });
   const [receipt] = await tx.select().from(commandReceipt).where(eq(commandReceipt.scopeHash, scopeHash)).for('update');
   if (!receipt) throw new CommandError('COMMAND_INCOMPLETE');
   if (receipt.requestHash !== requestHash) throw new CommandError('IDEMPOTENCY_CONFLICT');
   if (receipt.status === 'completed') return { commandId: receipt.commandId, result: receipt.result, replayed: true };
   const outcome = await work.execute(tx, payload);
   // Round-trip result so first execution and replay have identical JSON semantics.
   const result: JsonValue = JSON.parse(canonicalJson(outcome.result));
   const resourceId = label.parse(outcome.resourceId);
   const events = z.array(label).max(20).parse(outcome.events);
   if (new Set(events).size !== events.length) throw new Error('Duplicate event types');
   await tx.insert(auditEvent).values({ id: randomUUID(), commandId: receipt.commandId, gymId: deploymentGym, actorId: input.actorId, operation: input.operation, resourceId });
   if (events.length) await tx.insert(outboxEvent).values(events.map(eventType => ({ id: randomUUID(), commandId: receipt.commandId, gymId: deploymentGym, eventType, resourceId })));
   await tx.update(commandReceipt).set({ status: 'completed', result }).where(eq(commandReceipt.scopeHash, scopeHash));
   return { commandId: receipt.commandId, result, replayed: false };
  }, { isolationLevel: 'read committed' });
 };
}
