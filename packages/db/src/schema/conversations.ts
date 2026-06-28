import { pgTable, uuid, text, timestamp, jsonb, boolean, integer } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { contacts } from './contacts.js';
import { users } from './users.js';

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  externalConversationId: text('external_conversation_id').notNull(),
  platform: text('platform').notNull(),
  isGroup: boolean('is_group').default(false),
  title: text('title'),
  status: text('status').default('open'),
  priority: text('priority').default('medium'),
  lastMessagePreview: text('last_message_preview'),
  unreadCount: integer('unread_count').default(0),
  metadata: jsonb('metadata').default({}),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
