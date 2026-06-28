const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.lwvxxiuwquylbmhbpygu:zkfH0odz1234%21@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' });
client.connect()
  .then(() => client.query('insert into "organizations" ("name", "slug") values ($1, $2) returning *', ['Maillet', 'maillet']))
  .then(res => { console.log('Success:', res.rows); client.end(); })
  .catch(err => { console.error('Error connecting/querying:', err.message); client.end(); });
