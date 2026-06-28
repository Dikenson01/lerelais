import { FastifyInstance } from 'fastify';
import { db, messages, conversations } from '@lerelais/db';
import { eq, asc } from 'drizzle-orm';

export async function messagesRoutes(fastify: FastifyInstance) {
  // Get messages for a conversation
  fastify.get('/:conversationId', async (request) => {
    const { conversationId } = request.params as { conversationId: string };

    const data = await db.select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.timestamp));

    return data;
  });

  // Send a message (creates message + dispatches to connector)
  fastify.post('/:conversationId/send', async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    const { content, contentType } = request.body as { content: string; contentType?: string };

    // Get the conversation to find the right connector
    const [conv] = await db.select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conv) return { error: 'Conversation not found' };

    // Save the message as 'pending'
    const [msg] = await db.insert(messages).values({
      conversationId,
      senderType: 'agent',
      content,
      contentType: contentType || 'text',
      isFromMe: true,
      status: 'pending',
      timestamp: new Date(),
    }).returning();

    // TODO: Dispatch to the right connector based on conv.platform
    // For now, mark as sent
    const [updated] = await db.update(messages)
      .set({ status: 'sent' })
      .where(eq(messages.id, msg.id))
      .returning();

    // Update conversation preview
    await db.update(conversations)
      .set({
        lastMessagePreview: content,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    // Emit via Socket.IO
    const io = (fastify as any).io;
    if (io) {
      io.to(`conversation:${conversationId}`).emit('new_message', updated);
    }

    return updated;
  });
}
