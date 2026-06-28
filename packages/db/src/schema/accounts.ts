import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  platform: text('platform').notNull(),
  accountName: text('account_name'),
  credentials: jsonb('credentials').default({}),
  status: text('status').default('disconnected'),
  metadata: jsonb('metadata').default({}),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
