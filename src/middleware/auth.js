import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

export async function authenticateOwner(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.role !== 'owner') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const owner = await prisma.owner.findUnique({ where: { id: payload.id } });
    if (!owner || owner.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }

    req.owner = owner;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const admin = await prisma.admin.findUnique({ where: { id: payload.id } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.admin = admin;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
