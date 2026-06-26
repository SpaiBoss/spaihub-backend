import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';

export async function getMe(req, res, next) {
  try {
    const owner = req.owner;
    res.json({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      status: owner.status,
      emailVerified: owner.emailVerified,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req, res, next) {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const updated = await prisma.owner.update({
      where: { id: req.owner.id },
      data: { name: name.trim() },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        emailVerified: true,
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
