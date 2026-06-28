import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { db } from '@lerelais/db';
import { conversationsRoutes } from './modules/conversations/routes.js';
import { contactsRoutes } from './modules/contacts/routes.js';
import { messagesRoutes } from './modules/messages/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { campaignsRoutes } from './modules/campaigns/routes.js';
import { accountsRoutes } from './modules/accounts/routes.js';

const fastify = Fastify({
  logger: {
    level: 'info',
  },
});

// CORS
await fastify.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});

// Create HTTP server for Socket.IO
const httpServer = createServer(fastify.server);

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// Make io accessible to routes
fastify.decorate('io', io);

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(conversationsRoutes, { prefix: '/api/conversations' });
await fastify.register(contactsRoutes, { prefix: '/api/contacts' });
await fastify.register(messagesRoutes, { prefix: '/api/messages' });
await fastify.register(campaignsRoutes, { prefix: '/api/campaigns' });
await fastify.register(accountsRoutes, { prefix: '/api/accounts' });

// Health check
fastify.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
}));

// Socket.IO connection handling
io.on('connection', (socket) => {
  fastify.log.info(`Client connected: ${socket.id}`);

  socket.on('join_conversation', (conversationId: string) => {
    socket.join(`conversation:${conversationId}`);
    fastify.log.info(`Client ${socket.id} joined conversation:${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId: string) => {
    socket.leave(`conversation:${conversationId}`);
  });

  socket.on('disconnect', () => {
    fastify.log.info(`Client disconnected: ${socket.id}`);
  });
});

// Start server
const port = parseInt(process.env.PORT || '3000');

try {
  // Use httpServer.listen instead of fastify.listen for Socket.IO compatibility
  await fastify.ready();
  httpServer.listen(port, '0.0.0.0', () => {
    fastify.log.info(`LeRelais API running on http://localhost:${port}`);
  });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

export { fastify, io };
