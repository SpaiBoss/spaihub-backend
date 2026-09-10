import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma.js';
import {
  sendContributorVerificationEmail,
  sendContributorPasswordResetEmail,
} from '../services/email.js';
import { isValidEmail, normalizeEmail } from '../utils/queryValidation.js';

export async function registerContributor(req, res, next) {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalized = normalizeEmail(email);
    const existing = await prisma.contributor.findUnique({ where: { email: normalized } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const emailVerifyToken = uuidv4();

    const contributor = await prisma.contributor.create({
      data: {
        name: name.trim(),
        email: normalized,
        passwordHash,
        emailVerifyToken,
        status: 'PENDING',
      },
    });

    try {
      await sendContributorVerificationEmail(contributor.email, emailVerifyToken);
    } catch {
      // Email failure shouldn't block registration
    }

    res.status(201).json({
      message:
        'Registration successful. Please verify your email. An admin will activate your account before you can sign in.',
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyContributorEmail(req, res, next) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const contributor = await prisma.contributor.findFirst({ where: { emailVerifyToken: token } });
    if (!contributor) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    await prisma.contributor.update({
      where: { id: contributor.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        // Stay PENDING until admin Activate
      },
    });

    res.json({
      message: 'Email verified. An admin will approve your contributor account shortly.',
    });
  } catch (err) {
    next(err);
  }
}

export async function loginContributor(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const contributor = await prisma.contributor.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!contributor) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, contributor.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (contributor.status !== 'ACTIVE') {
      if (!contributor.emailVerified) {
        return res.status(403).json({
          error: 'Please verify your email before signing in.',
          code: 'EMAIL_UNVERIFIED',
        });
      }
      return res.status(403).json({
        error: 'Your account is awaiting admin approval.',
        code: 'AWAITING_APPROVAL',
      });
    }

    const token = jwt.sign(
      { id: contributor.id, email: contributor.email, role: 'contributor' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      contributor: {
        id: contributor.id,
        name: contributor.name,
        email: contributor.email,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function resendContributorVerification(req, res, next) {
  try {
    const { email } = req.body;
    if (!email?.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const contributor = await prisma.contributor.findUnique({
      where: { email: normalizeEmail(email) },
    });

    if (contributor && !contributor.emailVerified) {
      let token = contributor.emailVerifyToken;
      if (!token) {
        token = uuidv4();
        await prisma.contributor.update({
          where: { id: contributor.id },
          data: { emailVerifyToken: token },
        });
      }
      try {
        await sendContributorVerificationEmail(contributor.email, token);
      } catch {
        // swallow
      }
    }

    res.json({ message: 'If your email needs verification, a new link has been sent.' });
  } catch (err) {
    next(err);
  }
}

export async function forgotContributorPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const contributor = await prisma.contributor.findUnique({
      where: { email: normalizeEmail(email) },
    });
    if (contributor) {
      const resetPasswordToken = uuidv4();
      const resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.contributor.update({
        where: { id: contributor.id },
        data: { resetPasswordToken, resetPasswordExpiry },
      });
      try {
        await sendContributorPasswordResetEmail(contributor.email, resetPasswordToken);
      } catch {
        // swallow
      }
    }

    res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

export async function validateContributorResetToken(req, res, next) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Reset token is required' });
    }
    const contributor = await prisma.contributor.findFirst({ where: { resetPasswordToken: token } });
    if (!contributor || !contributor.resetPasswordExpiry || contributor.resetPasswordExpiry < new Date()) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired reset link' });
    }
    res.json({ valid: true });
  } catch (err) {
    next(err);
  }
}

export async function resetContributorPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const contributor = await prisma.contributor.findFirst({ where: { resetPasswordToken: token } });
    if (!contributor || !contributor.resetPasswordExpiry || contributor.resetPasswordExpiry < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.contributor.update({
      where: { id: contributor.id },
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
