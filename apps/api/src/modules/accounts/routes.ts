import { FastifyInstance } from 'fastify';
import { db, accounts } from '@lerelais/db';
import { eq, desc } from 'drizzle-orm';

export async function accountsRoutes(fastify: FastifyInstance) {
  // List all connected accounts
  fastify.get('/', async () => {
    return await db.select().from(accounts).orderBy(desc(accounts.createdAt));
  });

  // Create a new account (triggers connector setup)
  fastify.post('/', async (request) => {
    const body = request.body as typeof accounts.$inferInsert;
    const [account] = await db.insert(accounts).values(body).returning();
    
    // Trigger connector setup
    try {
      const { connectorManager } = await import('../../connectors/manager.js');
      await connectorManager.connectAccount(account.id, account.platform, account.credentials as Record<string, unknown> || {});
    } catch (err: any) {
      fastify.log.error(`Failed to connect account ${account.id}: ${err.message}`);
    }
    
    return account;
  });

  // Get account status
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return account || { error: 'Not found' };
  });

  // Delete account
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    await db.delete(accounts).where(eq(accounts.id, id));
    return { success: true };
  });
}
