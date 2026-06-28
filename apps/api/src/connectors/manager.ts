import { IChannelConnector } from '@lerelais/shared';
import { WhatsAppConnector } from './whatsapp/whatsapp-connector.js';

export class ConnectorManager {
  private static instance: ConnectorManager;
  private connectors: Map<string, IChannelConnector> = new Map();

  private constructor() {
    const waConnector = new WhatsAppConnector();
    this.connectors.set('whatsapp', waConnector);
    // Future: this.connectors.set('telegram', new TelegramConnector());
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
