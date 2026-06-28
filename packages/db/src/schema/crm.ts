import { pgTable, uuid, text, timestamp, jsonb, integer, numeric } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { contacts } from './contacts.js';

export const crmPipelines = pgTable('crm_pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const crmStages = pgTable('crm_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id').references(() => crmPipelines.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  color: text('color').default('#3b82f6'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const crmDeals = pgTable('crm_deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  pipelineId: uuid('pipeline_id').references(() => crmPipelines.id, { onDelete: 'cascade' }).notNull(),
  stageId: uuid('stage_id').references(() => crmStages.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  value: numeric('value', { precision: 12, scale: 2 }).default('0'),
  currency: text('currency').default('EUR'),
  status: text('status').default('open'),
  metadata: jsonb('metadata').default({}),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
