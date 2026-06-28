/**
 * Domain events emitted by the system.
 * These flow through Redis Pub/Sub for real-time features.
 */
export interface MessageReceivedEvent {
  type: 'message.received';
  conversationId: string;
  messageId: string;
  accountId: string;
  platform: string;
  content: string;
  contentType: string;
  senderName: string;
  timestamp: string;
}

export interface MessageSentEvent {
  type: 'message.sent';
  conversationId: string;
  messageId: string;
  accountId: string;
  platform: string;
  status: string;
}

export interface ConversationUpdatedEvent {
  type: 'conversation.updated';
  conversationId: string;
  changes: Record<string, unknown>;
}

export interface ConnectionStatusEvent {
  type: 'connection.status';
  accountId: string;
  platform: string;
  status: string;
  qrCode?: string;
}

export type DomainEvent =
  | MessageReceivedEvent
  | MessageSentEvent
  | ConversationUpdatedEvent
  | ConnectionStatusEvent;
