import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';
import { consumeTotpOrBackup, isTotpEnabled, totpErrorPayload } from '../services/totp.js';

function adminPayload(admin) {
  return {
    token: jwt.sign(
      { id: admin.id, email: admin.email, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    ),
    admin: { id: admin.id, email: admin.email, totpEnabled: isTotpEnabled(admin) },
  };
}

export async function adminLogin(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (isTotpEnabled(admin)) {
      const preAuthToken = jwt.sign(
        { id: admin.id, email: admin.email, role: 'admin_pre_totp' },
        process.env.JWT_SECRET,
        { expiresIn: '2m' },
      );
      return res.json({ needsTotp: true, preAuthToken });
    }

    res.json(adminPayload(admin));
  } catch (err) {
    next(err);
  }
}

export async function adminLoginTotp(req, res, next) {
  try {
    const { preAuthToken, totpCode, backupCode } = req.body || {};
    if (!preAuthToken) {
      return res.status(400).json({ error: 'preAuthToken is required' });
    }
    let payload;
    try {
      payload = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Authenticator step expired. Sign in again.' });
    }
    if (payload.role !== 'admin_pre_totp') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const admin = await prisma.admin.findUnique({ where: { id: payload.id } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    try {
      await consumeTotpOrBackup(prisma, 'admin', admin, { totpCode, backupCode });
    } catch (err) {
      const mapped = totpErrorPayload(err);
      if (mapped) return res.status(mapped.status).json(mapped.body);
      throw err;
    }
    res.json(adminPayload(admin));
  } catch (err) {
    next(err);
  }
}

export async function getAdminMe(req, res, next) {
  try {
    const admin = req.admin;
    res.json({
      id: admin.id,
      email: admin.email,
      totpEnabled: isTotpEnabled(admin),
    });
  } catch (err) {
    next(err);
  }
}

export async function requireAdminTotpIfEnabled(req, res) {
  if (!isTotpEnabled(req.admin)) return null;
  try {
    await consumeTotpOrBackup(prisma, 'admin', req.admin, {
      totpCode: req.body?.totpCode,
      backupCode: req.body?.backupCode,
    });
    return null;
  } catch (err) {
    const mapped = totpErrorPayload(err);
    if (mapped) {
      res.status(mapped.status).json(mapped.body);
      return mapped;
    }
    throw err;
  }
}
