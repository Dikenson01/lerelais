const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:fake@localhost:9999/fake' });
const db = drizzle(pool);
db.execute('select 1').catch(err => {
  console.log('Error name:', err.name);
  console.log('Error message:', err.message);
  console.log('Error object:', err);
  process.exit(0);
});
