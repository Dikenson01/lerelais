import { pgTable, uuid, text, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  externalMessageId: text('external_message_id'),
  senderType: text('sender_type').notNull(),
  senderId: text('sender_id'),
  content: text('content'),
  contentType: text('content_type').default('text'),
  mediaUrl: text('media_url'),
  mediaMetadata: jsonb('media_metadata').default({}),
  isFromMe: boolean('is_from_me').default(false),
  status: text('status').default('sent'),
  metadata: jsonb('metadata').default({}),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('messages_conversation_ts_idx').on(table.conversationId, table.timestamp),
  index('messages_external_id_idx').on(table.externalMessageId),
]);
