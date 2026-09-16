import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';
import { isPreferredLocale } from '../utils/locale.js';

export async function getMe(req, res, next) {
  try {
    const owner = req.owner;
    res.json({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      status: owner.status,
      emailVerified: owner.emailVerified,
      preferredLocale: owner.preferredLocale || 'en',
    });
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req, res, next) {
  try {
    const { name, preferredLocale } = req.body;
    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim();
    if (isPreferredLocale(preferredLocale)) data.preferredLocale = preferredLocale;
    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const updated = await prisma.owner.update({
      where: { id: req.owner.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        emailVerified: true,
        preferredLocale: true,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const valid = await bcrypt.compare(currentPassword, req.owner.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.owner.update({
      where: { id: req.owner.id },
      data: { passwordHash },
    });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}
