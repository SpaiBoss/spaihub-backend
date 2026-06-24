import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../utils/prisma.js';
import { parseBrandingInput, resolvePortalBranding } from '../utils/portalBranding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads/logos');

const MAX_LOGO_BYTES = 512 * 1024;
const ALLOWED_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

export async function getBranding(req, res, next) {
  try {
    const owner = await prisma.owner.findUnique({
      where: { id: req.owner.id },
      select: {
        portalBrandName: true,
        portalLogoUrl: true,
        portalAccentColor: true,
        portalWelcomeText: true,
        showPlatformCredit: true,
        portalShowUploadSpeed: true,
      },
    });

    res.json({
      ...owner,
      resolved: resolvePortalBranding(owner),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateBranding(req, res, next) {
  try {
    const parsed = parseBrandingInput(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const owner = await prisma.owner.update({
      where: { id: req.owner.id },
      data: parsed.data,
      select: {
        portalBrandName: true,
        portalLogoUrl: true,
        portalAccentColor: true,
        portalWelcomeText: true,
        showPlatformCredit: true,
        portalShowUploadSpeed: true,
      },
    });

    res.json({
      ...owner,
      resolved: resolvePortalBranding(owner),
    });
  } catch (err) {
    next(err);
  }
}

export async function uploadBrandingLogo(req, res, next) {
  try {
    const { dataUrl } = req.body;

    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'dataUrl is required' });
    }

    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Logo must be a PNG, JPEG, or WebP image' });
    }

    const mime = match[1];
    const ext = ALLOWED_MIME[mime];
    const buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > MAX_LOGO_BYTES) {
      return res.status(400).json({ error: 'Logo must be 512 KB or smaller' });
    }

    await ensureUploadsDir();
    const filename = `${req.owner.id}.${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    await fs.writeFile(filepath, buffer);

    const portalLogoUrl = `/uploads/logos/${filename}`;
    const owner = await prisma.owner.update({
      where: { id: req.owner.id },
      data: { portalLogoUrl },
      select: {
        portalBrandName: true,
        portalLogoUrl: true,
        portalAccentColor: true,
        portalWelcomeText: true,
        showPlatformCredit: true,
        portalShowUploadSpeed: true,
      },
    });

    res.json({
      ...owner,
      resolved: resolvePortalBranding(owner),
    });
  } catch (err) {
    next(err);
  }
}

export async function removeBrandingLogo(req, res, next) {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.owner.id } });
    if (owner?.portalLogoUrl?.startsWith('/uploads/logos/')) {
      const filepath = path.join(__dirname, '../..', owner.portalLogoUrl);
      await fs.unlink(filepath).catch(() => {});
    }

    const updated = await prisma.owner.update({
      where: { id: req.owner.id },
      data: { portalLogoUrl: null },
      select: {
        portalBrandName: true,
        portalLogoUrl: true,
        portalAccentColor: true,
        portalWelcomeText: true,
        showPlatformCredit: true,
        portalShowUploadSpeed: true,
      },
    });

    res.json({
      ...updated,
      resolved: resolvePortalBranding(updated),
    });
  } catch (err) {
    next(err);
  }
}
