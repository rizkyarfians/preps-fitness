import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import { mysqlTable, varchar, int } from 'drizzle-orm/mysql-core';
const spikeSlot = mysqlTable('spike_slot', { id: varchar('id', { length: 36 }).primaryKey(), remaining: int('remaining').notNull() });
import type { Database } from '../src/db/client.js';
import { createCommandRunner, CommandError, type CommandWork } from '../src/commands.js';
import { user, gymUser, branch, branchAccess, auditEvent, commandReceipt, outboxEvent } from '../src/db/schema.js';
export async function commandScenarios(t: TestContext, db: Database, gymId: string) {
 for (const id of ['admin-one', 'admin-two']) {
  await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  await db.insert(gymUser).values({ gymId, userId: id });
  await db.insert(branchAccess).values({ gymId, userId: id, branchId: 'branch-a', role: 'admin' });
 }
 const run = createCommandRunner(db, gymId);
 const request = { actorId: 'admin-one', branchId: 'branch-a', operation: 'spike.update', idempotencyKey: 'same-key', payload: { name: 'Updated' } };
 const authorize: CommandWork['authorize'] = async tx => {
  const [grant] = await tx.select().from(branchAccess).where(and(eq(branchAccess.gymId, gymId), eq(branchAccess.userId, 'admin-one'), eq(branchAccess.branchId, 'branch-a'), eq(branchAccess.role, 'admin'))).for('update');
  if (!grant) throw new CommandError('COMMAND_ACCESS_DENIED');
 };
 let executions = 0;
 const work: CommandWork = { authorize, async execute(tx, payload) {
  executions++;
  await tx.update(branch).set({ name: (payload as { name: string }).name }).where(and(eq(branch.id, 'branch-a'), eq(branch.gymId, gymId)));
  return { result: { name: (payload as { name: string }).name }, resourceId: 'branch-a', events: ['branch.updated'] };
 } };
 const records = async (operation: string) => {
  const receipts = await db.select().from(commandReceipt).where(eq(commandReceipt.operation, operation));
  const audits = await db.select().from(auditEvent).where(eq(auditEvent.operation, operation));
  const events = await db.select().from(outboxEvent).innerJoin(commandReceipt, eq(outboxEvent.commandId, commandReceipt.commandId)).where(eq(commandReceipt.operation, operation));
  return { receipts, audits, events };
 };
 await t.test('eight concurrent retries produce one mutation, receipt, audit and outbox event', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => run(request, work)));
  assert.equal(executions, 1); assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal(new Set(results.map(r => r.commandId)).size, 1);
  for (const r of results) assert.deepEqual(r.result, { name: 'Updated' });
  const rows = await records(request.operation);
  assert.equal(rows.receipts.length, 1); assert.equal(rows.audits.length, 1); assert.equal(rows.events.length, 1);
  assert.equal(rows.receipts[0]?.status, 'completed');
 });
 await t.test('same key with different payload conflicts without modifying domain data', async () => {
  await assert.rejects(() => run({ ...request, payload: { name: 'Wrong' } }, work), { reasonCode: 'IDEMPOTENCY_CONFLICT' });
  const [b] = await db.select().from(branch).where(eq(branch.id, 'branch-a')); assert.equal(b?.name, 'Updated');
 });
 await t.test('replay rechecks action permission and current account status', async () => {
  await assert.rejects(() => run(request, { ...work, authorize: async () => { throw new CommandError('COMMAND_ACCESS_DENIED'); } }), { reasonCode: 'COMMAND_ACCESS_DENIED' });
  await db.update(gymUser).set({ enabled: false }).where(and(eq(gymUser.gymId, gymId), eq(gymUser.userId, 'admin-one')));
  await assert.rejects(() => run(request, work), { reasonCode: 'COMMAND_ACCESS_DENIED' });
  await db.update(gymUser).set({ enabled: true }).where(and(eq(gymUser.gymId, gymId), eq(gymUser.userId, 'admin-one')));
 });
 await t.test('domain mutation rolls back with receipt, audit and outbox on database failure', async () => {
  const rollbackRequest = { ...request, operation: 'spike.rollback' };
  const failing: CommandWork = { authorize, async execute(tx) {
   await tx.update(branch).set({ name: 'Must rollback' }).where(eq(branch.id, 'branch-a'));
   // Exercise a real MySQL FK failure after a domain write.
   await tx.insert(branchAccess).values({ gymId, branchId: 'missing-branch', userId: 'admin-one', role: 'admin' });
   throw new Error('unreachable');
  } };
  await assert.rejects(() => run(rollbackRequest, failing));
  const rows = await records(rollbackRequest.operation);
  assert.equal(rows.receipts.length + rows.audits.length + rows.events.length, 0);
  const [b] = await db.select().from(branch).where(eq(branch.id, 'branch-a')); assert.equal(b?.name, 'Updated');
  assert.equal((await run(rollbackRequest, work)).replayed, false);
 });
 await t.test('failed outbox insertion also rolls back earlier audit and domain writes', async () => {
  const late = { ...request, operation: 'spike.outbox_failure' };
  const invalid: CommandWork = { authorize, async execute(tx) {
   await tx.update(branch).set({ name: 'Must also rollback' }).where(eq(branch.id, 'branch-a'));
   // Preinsert the same type so the wrapper hits its unique constraint after audit insertion.
   const [receipt] = await tx.select().from(commandReceipt).where(eq(commandReceipt.operation, late.operation));
   assert.ok(receipt);
   await tx.insert(outboxEvent).values({ id: 'deliberate-duplicate', commandId: receipt.commandId, gymId, eventType: 'branch.updated', resourceId: 'branch-a' });
   return { result: null, resourceId: 'branch-a', events: ['branch.updated'] };
  } };
  await assert.rejects(() => run(late, invalid));
  const rows = await records(late.operation); assert.equal(rows.receipts.length + rows.audits.length + rows.events.length, 0);
  const [b] = await db.select().from(branch).where(eq(branch.id, 'branch-a')); assert.equal(b?.name, 'Updated');
 });
 await t.test('two admins with different keys use domain row locking to consume the last slot once', async () => {
  // Disposable domain table models contention without introducing a production quota model.
  await db.execute(sql`CREATE TABLE spike_slot (id varchar(36) PRIMARY KEY, remaining int NOT NULL) ENGINE=InnoDB`);
  await txInit();
  async function txInit() { await db.insert(spikeSlot).values({ id: 'last-slot', remaining: 1 }); }
  const attempts = await Promise.allSettled(['admin-one', 'admin-two'].map(actorId => run({ ...request, actorId, operation: 'spike.last_slot', idempotencyKey: actorId }, {
   async authorize(tx) {
    const grants = await tx.select().from(branchAccess).where(and(eq(branchAccess.userId, actorId), eq(branchAccess.gymId, gymId), eq(branchAccess.branchId, 'branch-a'), eq(branchAccess.role, 'admin'))).for('update');
    if (!grants.length) throw new CommandError('COMMAND_ACCESS_DENIED');
   },
   async execute(tx) {
    const [row] = await tx.select().from(spikeSlot).where(eq(spikeSlot.id, 'last-slot')).for('update');
    if (row?.remaining !== 1) throw new Error('NO_SLOT');
    await tx.update(spikeSlot).set({ remaining: 0 }).where(eq(spikeSlot.id, 'last-slot'));
    return { result: { consumed: true }, resourceId: 'branch-a', events: ['slot.consumed'] };
   },
  })));
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
  const rejected = attempts.find(a => a.status === 'rejected'); assert.ok(rejected && rejected.status === 'rejected'); assert.equal(rejected.reason.message, 'NO_SLOT');
  const rows = await records('spike.last_slot'); assert.equal(rows.receipts.length, 1); assert.equal(rows.audits.length, 1); assert.equal(rows.events.length, 1);
  const [row] = await db.select().from(spikeSlot).where(eq(spikeSlot.id, 'last-slot')); assert.equal(row?.remaining, 0);
 });
 await t.test('wrong deployment and unauthorized branch cannot create a receipt', async () => {
  await assert.rejects(() => createCommandRunner(db, 'other-gym')(request, work), { reasonCode: 'COMMAND_ACCESS_DENIED' });
  await assert.rejects(() => run({ ...request, branchId: 'branch-b' }, work), { reasonCode: 'COMMAND_ACCESS_DENIED' });
 });
}
