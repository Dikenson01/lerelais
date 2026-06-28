const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.lwvxxiuwquylbmhbpygu:zkfH0odz1234%21@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' });
client.connect()
  .then(() => client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
  .then(res => { console.log('Tables:', res.rows.map(r => r.tablename)); client.end(); })
  .catch(err => { console.error('Error:', err.message); client.end(); });
