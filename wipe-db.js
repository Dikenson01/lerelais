const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.lwvxxiuwquylbmhbpygu:zkfH0odz1234%21@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' });
client.connect()
  .then(() => client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;'))
  .then(() => { console.log('Schema wiped successfully!'); client.end(); })
  .catch(err => { console.error('Error:', err.message); client.end(); });
