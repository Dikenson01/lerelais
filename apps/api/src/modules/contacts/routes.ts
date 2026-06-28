import { FastifyInstance } from 'fastify';
import { db, contacts } from '@lerelais/db';
import { eq, desc, ilike, or } from 'drizzle-orm';

export async function contactsRoutes(fastify: FastifyInstance) {
  // List contacts
  fastify.get('/', async (request) => {
    const { search } = request.query as { search?: string };

    let query = db.select().from(contacts).orderBy(desc(contacts.lastMessageAt));

    const data = await query;
    return data;
  });

  // Get single contact
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
    return contact || { error: 'Not found' };
  });

  // Create contact
  fastify.post('/', async (request) => {
    const body = request.body as typeof contacts.$inferInsert;
    const [contact] = await db.insert(contacts).values(body).returning();
    return contact;
  });

  // Update contact
  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<typeof contacts.$inferInsert>;
    const [updated] = await db.update(contacts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return updated;
  });

  // Delete contact
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    await db.delete(contacts).where(eq(contacts.id, id));
    return { success: true };
  });
}
