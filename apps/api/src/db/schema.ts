import { mysqlTable, varchar, text, boolean, timestamp, index, uniqueIndex, primaryKey, foreignKey, mysqlEnum, json, date, int } from 'drizzle-orm/mysql-core';
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
 id: id('id').primaryKey(), gymId: id('gym_id').notNull().references(() => gym.id), userId: id('user_id'),
 // Nullable for existing profiles; new registration input requires complete identity fields.
 fullName: varchar('full_name', { length: 200 }), phone: varchar('phone', { length: 16 }),
 address: varchar('address', { length: 1000 }), birthPlace: varchar('birth_place', { length: 120 }),
 birthDate: date('birth_date', { mode: 'string' }), email: varchar('email', { length: 254 }), ...dates(),
}, t => [uniqueIndex('member_scope').on(t.gymId, t.id), uniqueIndex('member_gym_user').on(t.gymId, t.userId), foreignKey({ columns: [t.gymId, t.userId], foreignColumns: [gymUser.gymId, gymUser.userId] })]);

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

export const planVersion = mysqlTable('plan_version', {
 id: id('id').primaryKey(), gymId: id('gym_id').notNull(), branchId: id('branch_id').notNull(),
 planId: id('plan_id').notNull(), version: int('version').notNull(),
 snapshot: json('snapshot').$type<import('../registration-validation.js').Offer>().notNull(),
 selectable: boolean('selectable').notNull().default(true),
 createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
}, t => [uniqueIndex('plan_branch_version').on(t.gymId, t.branchId, t.planId, t.version),
 uniqueIndex('plan_scope').on(t.gymId, t.branchId, t.id),
 foreignKey({ columns: [t.gymId, t.branchId], foreignColumns: [branch.gymId, branch.id] })]);
export const memberBranch = mysqlTable('member_branch', {
 gymId: id('gym_id').notNull(), branchId: id('branch_id').notNull(), memberId: id('member_id').notNull(),
}, t => [primaryKey({ columns: [t.gymId, t.branchId, t.memberId] }),
 foreignKey({ columns: [t.gymId, t.memberId], foreignColumns: [member.gymId, member.id] }),
 foreignKey({ columns: [t.gymId, t.branchId], foreignColumns: [branch.gymId, branch.id] })]);
export const registration = mysqlTable('registration', {
 id: id('id').primaryKey(), gymId: id('gym_id').notNull(), branchId: id('branch_id').notNull(), memberId: id('member_id').notNull(),
 newMember: boolean('new_member').notNull(),
 identity: json('identity').$type<Partial<import('../registration-validation.js').Identity>>().notNull(),
 offer: json('offer').$type<import('../registration-validation.js').Offer>().notNull(),
 status: mysqlEnum('status', ['draft','pending_review','needs_clarification','approved','rejected']).notNull().default('draft'),
 version: int('version').notNull().default(1), createdBy: id('created_by').notNull().references(() => user.id),
 history: json('history').$type<import('../registration-validation.js').ReviewEvent[]>().notNull(),
 submissions: json('submissions').$type<{identity:Partial<import('../registration-validation.js').Identity>;offer:import('../registration-validation.js').Offer;version:number;actorId:string;at:string}[]>().notNull(),
 duplicateResolutions: json('duplicate_resolutions').$type<(import('../registration-validation.js').Resolution & {actorId:string;at:string})[]>().notNull(),
 // Uniqueness only for pending/clarification. Null releases the slot after review.
 pendingMemberId: id('pending_member_id'), orderId: id('order_id'), ...dates(),
}, t => [uniqueIndex('registration_scope').on(t.gymId, t.id),
 uniqueIndex('registration_pending_member').on(t.gymId, t.branchId, t.pendingMemberId),
 index('registration_branch_list').on(t.gymId, t.branchId, t.createdAt, t.id),
 foreignKey({ columns: [t.gymId,t.branchId], foreignColumns: [branch.gymId,branch.id] }),
 foreignKey({ columns: [t.gymId,t.memberId], foreignColumns: [member.gymId,member.id] })]);
export const registrationOrder = mysqlTable('registration_order', {
 id: id('id').primaryKey(), gymId: id('gym_id').notNull(), registrationId: id('registration_id').notNull().unique(),
 offer: json('offer').$type<import('../registration-validation.js').Offer>().notNull(),
 createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
}, t => [foreignKey({ columns: [t.gymId,t.registrationId], foreignColumns: [registration.gymId,registration.id] })]);
export const candidateCheck = mysqlTable('candidate_check', {
 id: id('id').primaryKey(), gymId: id('gym_id').notNull().references(() => gym.id), actorId: id('actor_id').notNull().references(() => user.id),
 branchId: id('branch_id').notNull(), identityHash: varchar('identity_hash', { length:64 }).notNull(),
 candidatesHash: varchar('candidates_hash', { length:64 }).notNull(), expiresAt: timestamp('expires_at', { fsp:3 }).notNull(),
}, t => [index('candidate_expiry').on(t.expiresAt), foreignKey({ columns: [t.gymId,t.branchId], foreignColumns: [branch.gymId,branch.id] })]);
