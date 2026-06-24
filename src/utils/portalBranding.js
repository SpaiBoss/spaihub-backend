const HEX_COLOR_RE = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;

export function isValidAccentColor(value) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

export function resolvePortalBranding(owner) {
  const apiBase = (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(
    /\/$/,
    ''
  );

  let logoUrl = owner?.portalLogoUrl?.trim() || null;
  if (logoUrl?.startsWith('/uploads/')) {
    logoUrl = `${apiBase}${logoUrl}`;
  }

  return {
    brandName: owner?.portalBrandName?.trim() || null,
    logoUrl,
    accentColor: isValidAccentColor(owner?.portalAccentColor) ? owner.portalAccentColor.trim() : null,
    welcomeText: owner?.portalWelcomeText?.trim() || null,
    showPlatformCredit: true,
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
  };
}
