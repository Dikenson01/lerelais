import { WhatsAppConnector } from './connectors/whatsapp/whatsapp-connector.js';
import qrcodeTerminal from 'qrcode-terminal';

async function test() {
  console.log('Starting WhatsApp test...');
  const connector = new WhatsAppConnector('./data/test-sessions');
  
  // We need to listen to the raw Baileys socket for the terminal QR if we want it,
  // But wait, the Connector only emits the base64 URL.
  // We can just use the base64 URL by printing it out. The user can click it or copy-paste it to browser to scan.
  
  connector.on('qr_code', (payload: any) => {
    console.log('\n--- QR CODE ---');
    console.log('Ouvrez ce lien ou cette image dans votre navigateur pour scanner le QR Code :');
    console.log(payload.data.qrCode);
    console.log('---------------\n');
  });
  
  connector.on('connection_update', async (payload: any) => {
    console.log('STATUS:', payload.data.status);
    if (payload.data.status === 'connected') {
      console.log('✅ Connected! Sending test message to 33785790191...');
      const res = await connector.sendMessage('test-account', '33785790191', 'Bonjour ! Ceci est un test de la plateforme omnicanale LeRelais.');
      console.log('Send Result:', res);
      
      // Keep alive for 10 seconds to ensure message is sent
      setTimeout(() => {
        console.log('Exiting...');
        process.exit(0);
      }, 10000);
    }
  });

  await connector.connect('test-account');
}

test().catch(console.error);
