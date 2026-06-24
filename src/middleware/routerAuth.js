import prisma from '../utils/prisma.js';

export async function authenticateRouter(req, res, next) {
  try {
    const routerToken = req.headers['x-router-token'];
    if (!routerToken) {
      return res.status(401).json({ error: 'Router token required' });
    }

    const router = await prisma.router.findFirst({
      where: { routerToken, isActive: true },
      include: { location: true },
    });

    if (!router) {
      return res.status(401).json({ error: 'Invalid router token' });
    }

    req.router = router;
    next();
  } catch {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
