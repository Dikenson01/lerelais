import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { accounts } from './accounts.js';

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  externalId: text('external_id'),
  fullName: text('full_name'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  phone: text('phone'),
  email: text('email'),
  company: text('company'),
  notes: text('notes'),
  tags: text('tags').array().default([]),
  metadata: jsonb('metadata').default({}),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('contacts_org_external_idx').on(table.orgId, table.accountId, table.externalId)]);
