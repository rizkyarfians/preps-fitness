import { mysqlTable, varchar, text, boolean, timestamp, index, uniqueIndex, primaryKey, foreignKey, mysqlEnum, json } from 'drizzle-orm/mysql-core';
const id = (name: string) => varchar(name, { length: 36 });
const dates = () => ({ createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().defaultNow().$onUpdate(() => new Date()) });
export const user = mysqlTable('auth_user', {
 id: id('id').primaryKey(), name: varchar('name', { length: 255 }).notNull(), email: varchar('email', { length: 255 }).notNull().unique(),
 emailVerified: boolean('email_verified').notNull().default(false), image: text('image'), ...dates(),
});
export const session = mysqlTable('auth_session', {
 id: id('id').primaryKey(), token: varchar('token', { length: 255 }).notNull().unique(), expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
 ipAddress: text('ip_address'), userAgent: text('user_agent'), userId: id('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), ...dates(),
}, t => [index('session_user_idx').on(t.userId)]);
export const account = mysqlTable('auth_account', {
 id: id('id').primaryKey(), accountId: varchar('account_id', { length: 255 }).notNull(), providerId: varchar('provider_id', { length: 64 }).notNull(),
 userId: id('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
 accessTokenExpiresAt: timestamp('access_token_expires_at', { fsp: 3 }), refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { fsp: 3 }), scope: text('scope'), password: text('password'), ...dates(),
}, t => [index('account_user_idx').on(t.userId), uniqueIndex('account_provider_identity').on(t.providerId, t.accountId)]);
export const verification = mysqlTable('auth_verification', {
 id: id('id').primaryKey(), identifier: varchar('identifier', { length: 255 }).notNull(), value: text('value').notNull(), expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(), ...dates(),
}, t => [index('verification_identifier_idx').on(t.identifier)]);
export const gym = mysqlTable('gym', { id: id('id').primaryKey(), name: varchar('name', { length: 200 }).notNull(), ...dates() });
export const branch = mysqlTable('branch', {
 id: id('id').primaryKey(), gymId: id('gym_id').notNull().references(() => gym.id), name: varchar('name', { length: 200 }).notNull(), ...dates(),
}, t => [uniqueIndex('branch_gym_id').on(t.gymId, t.id)]);
export const gymUser = mysqlTable('gym_user', {
 gymId: id('gym_id').notNull().references(() => gym.id), userId: id('user_id').notNull().references(() => user.id), enabled: boolean('enabled').notNull().default(true), ...dates(),
}, t => [primaryKey({ columns: [t.gymId, t.userId] })]);
export const branchAccess = mysqlTable('branch_access', {
 gymId: id('gym_id').notNull(), branchId: id('branch_id').notNull(), userId: id('user_id').notNull(), role: mysqlEnum('role', ['owner', 'admin', 'pt', 'member']).notNull(),
}, t => [primaryKey({ columns: [t.gymId, t.branchId, t.userId, t.role] }),
 foreignKey({ columns: [t.gymId, t.branchId], foreignColumns: [branch.gymId, branch.id] }),
 foreignKey({ columns: [t.gymId, t.userId], foreignColumns: [gymUser.gymId, gymUser.userId] }),
]);
export const member = mysqlTable('member', {
 id: id('id').primaryKey(), gymId: id('gym_id').notNull(), userId: id('user_id').notNull(), ...dates(),
}, t => [uniqueIndex('member_gym_user').on(t.gymId, t.userId), foreignKey({ columns: [t.gymId, t.userId], foreignColumns: [gymUser.gymId, gymUser.userId] })]);

// Receipt and events are written in the SAME transaction as the domain mutation.
export const commandReceipt = mysqlTable('command_receipt', {
 scopeHash: varchar('scope_hash', { length: 64 }).primaryKey(),
 commandId: id('command_id').notNull().unique(),
 gymId: id('gym_id').notNull().references(() => gym.id),
 actorId: id('actor_id').notNull().references(() => user.id),
 branchId: id('branch_id').notNull(),
 operation: varchar('operation', { length: 100 }).notNull(),
 requestHash: varchar('request_hash', { length: 64 }).notNull(),
 status: mysqlEnum('status', ['pending', 'completed']).notNull(),
 result: json('result').$type<import('../commands.js').JsonValue>(),
 ...dates(),
}, t => [foreignKey({ columns: [t.gymId, t.branchId], foreignColumns: [branch.gymId, branch.id] }), index('receipt_gym_created').on(t.gymId, t.createdAt)]);
export const auditEvent = mysqlTable('audit_event', {
 id: id('id').primaryKey(), commandId: id('command_id').notNull().unique().references(() => commandReceipt.commandId),
 gymId: id('gym_id').notNull().references(() => gym.id), actorId: id('actor_id').notNull().references(() => user.id),
 operation: varchar('operation', { length: 100 }).notNull(), resourceId: varchar('resource_id', { length: 100 }).notNull(),
 createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
}, t => [index('audit_gym_created').on(t.gymId, t.createdAt)]);
export const outboxEvent = mysqlTable('outbox_event', {
 id: id('id').primaryKey(), commandId: id('command_id').notNull().references(() => commandReceipt.commandId),
 gymId: id('gym_id').notNull().references(() => gym.id),
 eventType: varchar('event_type', { length: 100 }).notNull(), resourceId: varchar('resource_id', { length: 100 }).notNull(),
 createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
 publishedAt: timestamp('published_at', { fsp: 3 }),
}, t => [uniqueIndex('outbox_command_type').on(t.commandId, t.eventType), index('outbox_pending').on(t.publishedAt, t.createdAt)]);
