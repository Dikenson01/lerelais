import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://lerelais:lerelais_dev_2026@localhost:5432/lerelais',
  },
});
