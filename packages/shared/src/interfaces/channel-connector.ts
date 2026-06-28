/**
 * Abstract interface that ALL platform connectors must implement.
 * This is the core abstraction that makes the platform channel-agnostic.
 */
export interface IChannelConnector {
  /** Unique platform identifier */
  readonly platform: string;

  /** Initialize the connector with account credentials */
  connect(accountId: string, credentials?: Record<string, unknown>): Promise<void>;

  /** Disconnect and cleanup */
  disconnect(accountId: string): Promise<void>;

  /** Send a text message */
  sendMessage(accountId: string, to: string, content: string): Promise<SendResult>;

  /** Send a media message (image, video, document) */
  sendMedia(accountId: string, to: string, mediaUrl: string, caption?: string): Promise<SendResult>;

  /** Get the connection status */
  getStatus(accountId: string): ConnectionStatus;

  /** Get native contacts from the platform (if supported) */
  getContacts(accountId: string): Promise<NativeContact[]>;

  /** Register an event handler */
  on(event: ConnectorEvent, handler: ConnectorEventHandler): void;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface NativeContact {
  externalId: string;
  name: string;
  phone?: string;
  avatarUrl?: string;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'pairing' | 'error';

export type ConnectorEvent =
  | 'message'
  | 'message_status'
  | 'connection_update'
  | 'qr_code'
  | 'contacts_sync';

export interface ConnectorEventPayload {
  accountId: string;
  platform: string;
  data: unknown;
}

export type ConnectorEventHandler = (payload: ConnectorEventPayload) => void | Promise<void>;
