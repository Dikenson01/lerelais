import { FastifyInstance } from 'fastify';
import { db } from '@lerelais/db';
import { users, organizations } from '@lerelais/db';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export async function authRoutes(fastify: FastifyInstance) {
  // Register
  fastify.post('/register', async (request, reply) => {
    const { email, password, displayName, orgName } = request.body as {
      email: string;
      password: string;
      displayName: string;
      orgName: string;
    };

    // Create org
    const [org] = await db.insert(organizations).values({
      name: orgName,
      slug: orgName.toLowerCase().replace(/\s+/g, '-'),
    }).returning();

    // Create user
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(users).values({
      orgId: org.id,
      email,
      passwordHash,
      displayName,
      role: 'owner',
    }).returning();

    const token = jwt.sign(
      { userId: user.id, orgId: org.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return { token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role }, org: { id: org.id, name: org.name } };
  });

  // Login
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, orgId: user.orgId, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return { token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
  });

  // Me
  fastify.get('/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return reply.status(401).send({ error: 'No token' });

    try {
      const token = authHeader.replace('Bearer ', '');
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; orgId: string; role: string };
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) return reply.status(401).send({ error: 'User not found' });

      return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, orgId: user.orgId };
    } catch {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });
}
