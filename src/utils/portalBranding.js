const HEX_COLOR_RE = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;

export function isValidAccentColor(value) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

export function getPublicApiBase(req) {
  if (process.env.API_BASE_URL?.trim()) {
    return process.env.API_BASE_URL.trim().replace(/\/$/, '');
  }
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host) return `${proto}://${host}`;
  }
  return `http://localhost:${process.env.PORT || 4000}`;
}

export function resolveStoredLogoUrl(stored, req) {
  if (!stored) return null;
  const trimmed = stored.trim();

  const apiBase = getPublicApiBase(req);
  const embeddedLogo = trimmed.match(/logos\/([0-9a-f-]{36}(?:-\d+)?\.(?:png|jpe?g|webp))(?:\?.*)?$/i);
  if (embeddedLogo) {
    return `${apiBase}/media/logos/${embeddedLogo[1]}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/uploads/')) {
    return `${apiBase}${trimmed}`;
  }
  if (trimmed.startsWith('logos/')) {
    return `${apiBase}/media/${trimmed}`;
  }

  return trimmed;
}

export function resolvePortalBranding(owner, req) {
  const logoUrl = resolveStoredLogoUrl(owner?.portalLogoUrl, req);

  return {
    brandName: owner?.portalBrandName?.trim() || null,
    logoUrl,
    accentColor: isValidAccentColor(owner?.portalAccentColor) ? owner.portalAccentColor.trim() : null,
    welcomeText: owner?.portalWelcomeText?.trim() || null,
    showPlatformCredit: true,
    showUploadSpeed: owner?.portalShowUploadSpeed === true,
  };
}

export function parseBrandingInput(body) {
  const data = {};

  if (body.portalBrandName !== undefined) {
    const value = String(body.portalBrandName).trim();
    data.portalBrandName = value || null;
  }

  if (body.portalLogoUrl !== undefined) {
    const value = String(body.portalLogoUrl).trim();
    if (value && !/^https?:\/\//i.test(value) && !value.startsWith('/uploads/')) {
      return { error: 'Logo URL must be http(s) or an uploaded file' };
    }
    data.portalLogoUrl = value || null;
  }

  if (body.portalAccentColor !== undefined) {
    const value = String(body.portalAccentColor).trim();
    if (value && !isValidAccentColor(value)) {
      return { error: 'Accent color must be a valid hex code (e.g. #5463FF)' };
    }
    data.portalAccentColor = value || null;
  }

  if (body.portalWelcomeText !== undefined) {
    const value = String(body.portalWelcomeText).trim();
    data.portalWelcomeText = value.slice(0, 160) || null;
  }

  if (body.portalShowUploadSpeed !== undefined) {
    data.portalShowUploadSpeed = body.portalShowUploadSpeed === true;
  }

  if (body.showPlatformCredit !== undefined && body.showPlatformCredit === false) {
    return { error: 'Removing the platform credit requires a custom agreement. Contact us at spaitrace.com to negotiate.' };
  }

  return { data };
}

export function brandingSelectFields() {
  return {
    portalBrandName: true,
    portalLogoUrl: true,
    portalAccentColor: true,
    portalWelcomeText: true,
    showPlatformCredit: true,
    portalShowUploadSpeed: true,
  };
}

export function resolveLocalLogoPath(logoUrl) {
  if (!logoUrl?.startsWith('/uploads/')) return null;
  return logoUrl;
}
