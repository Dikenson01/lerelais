import { FastifyInstance } from 'fastify';
import { db, conversations, contacts, messages } from '@lerelais/db';
import { eq, desc, ilike, or, sql } from 'drizzle-orm';

export async function conversationsRoutes(fastify: FastifyInstance) {
  // List conversations
  fastify.get('/', async (request) => {
    const { search, status } = request.query as { search?: string; status?: string };

    let query = db.select()
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .orderBy(desc(conversations.lastActivityAt));

    const data = await query;

    return data.map(row => ({
      ...row.conversations,
      contact: row.contacts,
    }));
  });

  // Get single conversation
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };

    const [conv] = await db.select()
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.id, id))
      .limit(1);

    if (!conv) return { error: 'Not found' };

    return { ...conv.conversations, contact: conv.contacts };
  });

  // Update conversation (assign, change status, etc.)
  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<typeof conversations.$inferInsert>;

    const [updated] = await db.update(conversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();

    return updated;
  });
}
