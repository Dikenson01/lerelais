const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.lwvxxiuwquylbmhbpygu:zkfH0odz1234%21@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' });
client.connect()
  .then(() => client.query('SELECT * FROM organizations; SELECT * FROM users;'))
  .then(res => { console.log('Orgs:', res[0].rows); console.log('Users:', res[1].rows); client.end(); })
  .catch(err => { console.error('Error:', err.message); client.end(); });
