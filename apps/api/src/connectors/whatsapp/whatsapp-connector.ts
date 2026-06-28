import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import { IChannelConnector, SendResult, ConnectionStatus, NativeContact, ConnectorEvent, ConnectorEventHandler } from '@lerelais/shared';
import * as path from 'path';
import * as fs from 'fs';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';

export class WhatsAppConnector implements IChannelConnector {
  public readonly platform = 'whatsapp';
  private sockets: Map<string, ReturnType<typeof makeWASocket>> = new Map();
  private eventHandlers: Map<ConnectorEvent, Set<ConnectorEventHandler>> = new Map();
  
  constructor(private sessionsDir: string = path.join(process.cwd(), 'data', 'sessions')) {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  on(event: ConnectorEvent, handler: ConnectorEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  private emit(event: ConnectorEvent, accountId: string, data: unknown) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        Promise.resolve(handler({ accountId, platform: this.platform, data })).catch(console.error);
      }
    }
  }

  async connect(accountId: string): Promise<void> {
    const sessionPath = path.join(this.sessionsDir, `wa-${accountId}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['LeRelais', 'Chrome', '1.0.0'],
    });

    this.sockets.set(accountId, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          this.emit('qr_code', accountId, { qrCode: qrDataUrl });
          
          // Print the base64 string for easy testing
          console.log('\n--- BASE64 QR CODE ---');
          console.log(qrDataUrl);
          console.log('----------------------\n');
        } catch (err) {
          console.error('Failed to generate QR code', err);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.emit('connection_update', accountId, { status: shouldReconnect ? 'pairing' : 'disconnected' });
        
        if (shouldReconnect) {
          this.connect(accountId);
        } else {
          // Logged out
          this.sockets.delete(accountId);
          fs.rmSync(sessionPath, { recursive: true, force: true });
        }
      } else if (connection === 'open') {
        this.emit('connection_update', accountId, { status: 'connected' });
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            this.emit('message', accountId, {
              messageId: msg.key.id,
              from: msg.key.remoteJid,
              senderName: msg.pushName,
              content: msg.message.conversation || msg.message.extendedTextMessage?.text || '[Media]',
              timestamp: msg.messageTimestamp,
            });
          }
        }
      }
    });
  }

  async disconnect(accountId: string): Promise<void> {
    const sock = this.sockets.get(accountId);
    if (sock) {
      sock.logout();
      this.sockets.delete(accountId);
      const sessionPath = path.join(this.sessionsDir, `wa-${accountId}`);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
      this.emit('connection_update', accountId, { status: 'disconnected' });
    }
  }

  async sendMessage(accountId: string, to: string, content: string): Promise<SendResult> {
    const sock = this.sockets.get(accountId);
    if (!sock) return { success: false, error: 'Not connected' };

    try {
      const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
      const sent = await sock.sendMessage(jid, { text: content });
      return { success: true, messageId: sent?.key?.id || undefined };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async sendMedia(accountId: string, to: string, mediaUrl: string, caption?: string): Promise<SendResult> {
    return { success: false, error: 'Not implemented in Phase 1' };
  }

  getStatus(accountId: string): ConnectionStatus {
    const sock = this.sockets.get(accountId);
    if (!sock) return 'disconnected';
    return 'connected'; // Simplified for now
  }

  async getContacts(accountId: string): Promise<NativeContact[]> {
    return []; // Contacts sync requires storing them in memory or DB from bailey's store
  }
}
