import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { db } from '@lerelais/db';
import { authRoutes } from './modules/auth/routes.js';
import { conversationsRoutes } from './modules/conversations/routes.js';
import { contactsRoutes } from './modules/contacts/routes.js';
import { messagesRoutes } from './modules/messages/routes.js';
import { campaignsRoutes } from './modules/campaigns/routes.js';
import { accountsRoutes } from './modules/accounts/routes.js';
import { Telegraf } from 'telegraf';

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

// Socket.IO setup
const io = new Server(fastify.server, {
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

import { connectorManager } from './connectors/manager.js';

connectorManager.on('qr_code', (payload: any) => {
  io.emit('qr_code', payload.data);
});

connectorManager.on('connection_update', (payload: any) => {
  io.emit('connection_update', payload.data);
});

// Health check
fastify.get('/api/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
}));

// Serve Frontend Static Files
fastify.register(fastifyStatic, {
  root: path.join(process.cwd(), '../web/out'),
  prefix: '/',
  extensions: ['html'],
});

fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    reply.status(404).send({ error: 'Not Found' });
  } else if (request.url === '/index.html' || request.url === '/404.html') {
    reply.status(404).send('Not Found');
  } else {
    reply.sendFile('index.html');
  }
});

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

// Telegram Bot setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (botToken) {
  const bot = new Telegraf(botToken);
  
  bot.start((ctx) => {
    ctx.reply('👋 Bienvenue sur Le Relais ! Le bot est en ligne et fonctionnel. 🚀\n\nCliquez sur le bouton ci-dessous pour accéder à la plateforme :', {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Ouvrir Le Relais (Mini App)", web_app: { url: "https://lerelais-app-production.up.railway.app" } }],
          [{ text: "Ouvrir dans le navigateur", url: "https://lerelais-app-production.up.railway.app" }]
        ]
      }
    });
  });

  bot.launch().then(() => {
    fastify.log.info('🤖 Bot Telegram démarré avec succès');
  }).catch(err => {
    fastify.log.error('Erreur lors du lancement du bot Telegram:', err);
  });

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  fastify.log.warn('⚠️ TELEGRAM_BOT_TOKEN non défini. Le bot Telegram ne sera pas démarré.');
}

// Start server
const port = parseInt(process.env.PORT || '3000');

try {
  await fastify.listen({ port, host: '0.0.0.0' });
  fastify.log.info(`LeRelais API running on http://0.0.0.0:${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

export { fastify, io };
