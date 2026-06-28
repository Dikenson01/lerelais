import { IChannelConnector } from '@lerelais/shared';
import { WhatsAppConnector } from './whatsapp/whatsapp-connector.js';

export class ConnectorManager {
  private static instance: ConnectorManager;
  private connectors: Map<string, IChannelConnector> = new Map();

  private eventHandlers: Map<string, Set<any>> = new Map();

  private constructor() {
    const waConnector = new WhatsAppConnector();
    
    // Forward connector events to manager
    const forwardEvent = (eventName: string) => (payload: any) => {
      const handlers = this.eventHandlers.get(eventName);
      if (handlers) {
        handlers.forEach(handler => handler(payload));
      }
    };
    
    waConnector.on('qr_code', forwardEvent('qr_code'));
    waConnector.on('connection_update', forwardEvent('connection_update'));
    waConnector.on('message', forwardEvent('message'));
    
    this.connectors.set('whatsapp', waConnector);
    // Future: this.connectors.set('telegram', new TelegramConnector());
  }

  public on(event: string, handler: any): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  public static getInstance(): ConnectorManager {
    if (!ConnectorManager.instance) {
      ConnectorManager.instance = new ConnectorManager();
    }
    return ConnectorManager.instance;
  }

  public getConnector(platform: string): IChannelConnector | undefined {
    return this.connectors.get(platform);
  }

  public async connectAccount(accountId: string, platform: string, credentials?: Record<string, unknown>): Promise<void> {
    const connector = this.getConnector(platform);
    if (!connector) throw new Error(`Connector for platform ${platform} not found`);
    await connector.connect(accountId, credentials);
  }

  public async disconnectAccount(accountId: string, platform: string): Promise<void> {
    const connector = this.getConnector(platform);
    if (!connector) return;
    await connector.disconnect(accountId);
  }
}

export const connectorManager = ConnectorManager.getInstance();
