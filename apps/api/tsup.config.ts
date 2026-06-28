import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  clean: true,
  noExternal: ['@lerelais/db', '@lerelais/shared'],
  external: ['pg', 'drizzle-orm', 'dotenv'],
});
