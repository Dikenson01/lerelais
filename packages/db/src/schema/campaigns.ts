import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { accounts } from './accounts.js';
import { contacts } from './contacts.js';

export const contactLists = pgTable('contact_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const contactListMembers = pgTable('contact_list_members', {
  listId: uuid('list_id').references(() => contactLists.id, { onDelete: 'cascade' }).notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }).notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  listId: uuid('list_id').references(() => contactLists.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  messageTemplate: text('message_template').notNull(),
  status: text('status').default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  stats: jsonb('stats').default({ sent: 0, delivered: 0, failed: 0, replied: 0 }),
  settings: jsonb('settings').default({ minDelay: 15, maxDelay: 45, simulateTyping: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const campaignLogs = pgTable('campaign_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  messageSent: text('message_sent'),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
});
