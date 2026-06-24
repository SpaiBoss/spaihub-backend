import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.js';

export async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await prisma.owner.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const emailVerifyToken = uuidv4();

    const owner = await prisma.owner.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase(),
        passwordHash,
        emailVerifyToken,
        status: 'PENDING',
      },
    });

    try {
      await sendVerificationEmail(owner.email, emailVerifyToken);
    } catch {
      // Email failure shouldn't block registration
    }

    res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req, res, next) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const owner = await prisma.owner.findFirst({ where: { emailVerifyToken: token } });
    if (!owner) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    await prisma.owner.update({
      where: { id: owner.id },
      data: {
        emailVerified: true,
        status: 'ACTIVE',
        emailVerifyToken: null,
      },
    });

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const owner = await prisma.owner.findUnique({ where: { email: email.toLowerCase() } });
    if (!owner) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, owner.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (owner.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is not active. Please verify your email or contact support.' });
    }

    const token = jwt.sign(
      { id: owner.id, email: owner.email, role: 'owner' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      owner: { id: owner.id, name: owner.name, email: owner.email },
    });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const owner = await prisma.owner.findUnique({ where: { email: email.toLowerCase() } });
    if (owner) {
      const resetPasswordToken = uuidv4();
      const resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000);

      await prisma.owner.update({
        where: { id: owner.id },
        data: { resetPasswordToken, resetPasswordExpiry },
      });

      try {
        await sendPasswordResetEmail(owner.email, resetPasswordToken);
      } catch {
        // Don't reveal email send failures
      }
    }

    res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const owner = await prisma.owner.findFirst({ where: { resetPasswordToken: token } });
    if (!owner || !owner.resetPasswordExpiry || owner.resetPasswordExpiry < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.owner.update({
      where: { id: owner.id },
      data: {
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
      },
    });

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    next(err);
  }
}
