import { FastifyInstance } from 'fastify';
import { db, campaigns, contactLists, contactListMembers, contacts, campaignLogs } from '@lerelais/db';
import { eq, desc } from 'drizzle-orm';

export async function campaignsRoutes(fastify: FastifyInstance) {
  // --- Contact Lists ---
  fastify.get('/lists', async () => {
    return await db.select().from(contactLists).orderBy(desc(contactLists.createdAt));
  });

  fastify.post('/lists', async (request) => {
    const body = request.body as typeof contactLists.$inferInsert;
    const [list] = await db.insert(contactLists).values(body).returning();
    return list;
  });

  fastify.post('/lists/:listId/members', async (request) => {
    const { listId } = request.params as { listId: string };
    const { contactIds } = request.body as { contactIds: string[] };
    
    const values = contactIds.map(id => ({ listId, contactId: id }));
    if (values.length > 0) {
      await db.insert(contactListMembers).values(values).onConflictDoNothing();
    }
    return { success: true, count: values.length };
  });

  // --- Campaigns ---
  fastify.get('/', async () => {
    return await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));
  });

  fastify.post('/', async (request) => {
    const body = request.body as typeof campaigns.$inferInsert;
    const [campaign] = await db.insert(campaigns).values(body).returning();
    return campaign;
  });

  fastify.post('/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    const [updated] = await db.update(campaigns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(campaigns.id, id))
      .returning();
    return updated;
  });

  fastify.get('/:id/logs', async (request) => {
    const { id } = request.params as { id: string };
    return await db.select()
      .from(campaignLogs)
      .leftJoin(contacts, eq(campaignLogs.contactId, contacts.id))
      .where(eq(campaignLogs.campaignId, id))
      .orderBy(desc(campaignLogs.sentAt));
  });
}
