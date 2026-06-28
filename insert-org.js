const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.lwvxxiuwquylbmhbpygu:zkfH0odz1234%21@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' });
client.connect()
  .then(() => client.query(`
    INSERT INTO "organizations" ("id", "name", "slug") 
    VALUES ('00000000-0000-0000-0000-000000000000', 'Default Org', 'default-org') 
    ON CONFLICT ("id") DO NOTHING;
  `))
  .then(() => console.log('Organization inserted!'))
  .catch(console.error)
  .finally(() => client.end());
