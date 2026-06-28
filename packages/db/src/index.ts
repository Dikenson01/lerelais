import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://lerelais:lerelais_dev_2026@localhost:5432/lerelais',
});

export const db = drizzle(pool, { schema });
export * from './schema/index.js';
export type Database = typeof db;
