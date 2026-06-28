const http = require('http');

const req = http.request({
  hostname: '127.0.0.1',
  port: 10000,
  path: '/api/accounts',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, data));
});

req.on('error', (e) => console.error(e));
req.write(JSON.stringify({
  platform: 'whatsapp',
  accountName: 'Test',
  orgId: '00000000-0000-0000-0000-000000000000'
}));
req.end();
