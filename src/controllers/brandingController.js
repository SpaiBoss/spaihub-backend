import prisma from '../utils/prisma.js';
import { parseBrandingInput, resolvePortalBranding } from '../utils/portalBranding.js';
import { deleteOwnerLogo, getStorageMode, uploadOwnerLogo } from '../services/objectStorage.js';

const MAX_LOGO_BYTES = 512 * 1024;
const ALLOWED_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

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
      resolved: resolvePortalBranding(owner, req),
      logoStorage: getStorageMode(),
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
      resolved: resolvePortalBranding(owner, req),
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

    const existing = await prisma.owner.findUnique({
      where: { id: req.owner.id },
      select: { portalLogoUrl: true },
    });
    if (existing?.portalLogoUrl) {
      await deleteOwnerLogo(existing.portalLogoUrl);
    }

    const portalLogoUrl = await uploadOwnerLogo(req.owner.id, buffer, ext);
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
      resolved: resolvePortalBranding(owner, req),
    });
  } catch (err) {
    if (err.name === 'CredentialsProviderError' || err.Code === 'InvalidAccessKeyId') {
      return res.status(503).json({ error: 'Logo storage is misconfigured. Check R2 credentials on the server.' });
    }
    next(err);
  }
}

export async function removeBrandingLogo(req, res, next) {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.owner.id } });
    if (owner?.portalLogoUrl) {
      await deleteOwnerLogo(owner.portalLogoUrl);
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
      resolved: resolvePortalBranding(updated, req),
    });
  } catch (err) {
    next(err);
  }
}
