import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;

const NAVY = '#1A3C5E';
const BRAND = '#5463FF';
const MUTED = '#64748b';
const LIGHT = '#f1f5f9';

export const PDF_LAYOUTS = {
  2: { cols: 1, rows: 2, label: '2 per page (large)' },
  4: { cols: 2, rows: 2, label: '4 per page' },
  6: { cols: 2, rows: 3, label: '6 per page' },
  8: { cols: 2, rows: 4, label: '8 per page' },
  10: { cols: 2, rows: 5, label: '10 per page' },
  12: { cols: 3, rows: 4, label: '12 per page' },
};

function formatDuration(minutes) {
  if (!minutes) return '';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [];
  if (days) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} hr${hours !== 1 ? 's' : ''}`);
  if (!days && !hours) parts.push(`${minutes} min`);
  return parts.join(' ');
}

function formatPackageLine(pkg) {
  if (!pkg) return '';
  if (pkg.type === 'DATA_BASED') {
    const cap = pkg.dataCapMb >= 1024 ? `${(pkg.dataCapMb / 1024).toFixed(0)} GB` : `${pkg.dataCapMb} MB`;
    return `${cap} data · ${formatDuration(pkg.durationMinutes)} validity`;
  }
  const browse = formatDuration(pkg.durationMinutes);
  const cap = pkg.dataCapMb
    ? pkg.dataCapMb >= 1024
      ? `${(pkg.dataCapMb / 1024).toFixed(0)} GB cap`
      : `${pkg.dataCapMb} MB cap`
    : 'Unlimited data';
  return `${browse} · ${cap}`;
}

export async function loadBrandingAssets(branding = {}) {
  const accent = branding.accentColor || BRAND;
  const brandName = branding.brandName?.trim() || null;
  let logoBuffer = null;

  const logoUrl = branding.logoUrl;
  if (logoUrl?.startsWith('/uploads/')) {
    const localPath = path.join(UPLOADS_ROOT, logoUrl.replace(/^\/uploads\//, ''));
    if (fs.existsSync(localPath)) {
      logoBuffer = fs.readFileSync(localPath);
    }
  } else if (logoUrl && /^https?:\/\//i.test(logoUrl)) {
    try {
      const response = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 10000 });
      logoBuffer = Buffer.from(response.data);
    } catch {
      logoBuffer = null;
    }
  }

  return { accent, brandName, logoBuffer, welcomeText: branding.welcomeText?.trim() || null };
}

function drawTextBrand(doc, x, y, width, assets, size) {
  const opts = { width, align: 'center' };
  const name = assets.brandName;
  if (name) {
    doc.font('Helvetica-Bold').fontSize(size).fillColor(NAVY).text(name, x, y, opts);
    return;
  }
  doc.font('Helvetica-Bold').fontSize(size).fillColor(BRAND).text('Spai-Hub', x, y, opts);
}

function drawBrandHeader(doc, box, assets) {
  const { x, y, w } = box;
  const pad = 12;
  const innerX = x + pad;
  let cursorY = y + pad;
  const innerW = w - pad * 2;
  const large = box.h > 130;

  doc.save();
  doc.rect(x + 6, y + 6, w - 12, 4).fill(assets.accent);
  doc.restore();

  if (assets.logoBuffer) {
    try {
      const logoH = large ? 22 : 18;
      doc.image(assets.logoBuffer, innerX, cursorY, {
        fit: [innerW, logoH],
        align: 'center',
      });
      cursorY += logoH + (large ? 8 : 6);
    } catch {
      drawTextBrand(doc, innerX, cursorY, innerW, assets, large ? 13 : 11);
      cursorY += large ? 18 : 15;
    }
  } else {
    drawTextBrand(doc, innerX, cursorY, innerW, assets, large ? 13 : 11);
    cursorY += large ? 18 : 15;
  }

  return cursorY;
}

function drawTicket(doc, voucher, box, assets) {
  const { x, y, w, h } = box;
  const pad = 10;
  const innerX = x + pad + 2;
  const innerW = w - pad * 2 - 4;
  const large = h > 130;

  doc.save();
  doc.lineWidth(0.75).strokeColor('#dbeafe').fillColor('#ffffff');
  doc.roundedRect(x + 4, y + 4, w - 8, h - 8, 8).fillAndStroke();
  doc.restore();

  let cursorY = drawBrandHeader(doc, { x, y, w, h }, assets);
  cursorY += large ? 2 : 0;

  doc.font('Helvetica').fontSize(large ? 7.5 : 7).fillColor(MUTED);
  doc.text(voucher.location.name.toUpperCase(), innerX, cursorY, {
    width: innerW,
    align: 'center',
    characterSpacing: 0.4,
  });
  cursorY += large ? 12 : 10;

  doc.font('Helvetica-Bold').fontSize(large ? 10 : 9).fillColor(NAVY);
  doc.text(voucher.package.name, innerX, cursorY, { width: innerW, align: 'center' });
  cursorY += large ? 13 : 11;

  const detail = formatPackageLine(voucher.package);
  if (detail) {
    doc.font('Helvetica').fontSize(7).fillColor(MUTED);
    doc.text(detail, innerX, cursorY, { width: innerW, align: 'center' });
    cursorY += large ? 11 : 9;
  }

  const codeBoxY = cursorY + 2;
  const codeBoxH = large ? 28 : 24;
  doc.save();
  doc.roundedRect(innerX, codeBoxY, innerW, codeBoxH, 5).fill(LIGHT);
  doc.restore();

  const codeSize = large ? 15 : h > 95 ? 12 : 10;
  doc.font('Courier-Bold').fontSize(codeSize).fillColor(NAVY);
  doc.text(voucher.code, innerX, codeBoxY + (codeBoxH - codeSize) / 2 - 1, {
    width: innerW,
    align: 'center',
  });
  cursorY = codeBoxY + codeBoxH + (large ? 8 : 6);

  if (voucher.pin) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED);
    doc.text('WIFI PIN', innerX, cursorY, { width: innerW, align: 'center', characterSpacing: 0.8 });
    cursorY += large ? 10 : 8;
    doc.font('Courier-Bold').fontSize(large ? 16 : 14).fillColor(assets.accent);
    doc.text(voucher.pin, innerX, cursorY, { width: innerW, align: 'center' });
    cursorY += large ? 16 : 13;
  }

  const footnotes = [];
  if (voucher.batchLabel) footnotes.push(`Batch ${voucher.batchLabel}`);
  if (voucher.expiresAt) {
    footnotes.push(`Valid until ${new Date(voucher.expiresAt).toLocaleDateString()}`);
  }
  const instruction = assets.welcomeText || 'Enter code + PIN on the WiFi login page';
  footnotes.push(instruction);

  doc.font('Helvetica').fontSize(6).fillColor(MUTED);
  doc.text(footnotes.join(' · '), innerX, Math.min(cursorY, y + h - pad - 18), {
    width: innerW,
    align: 'center',
  });

  doc.font('Helvetica').fontSize(5.5).fillColor('#94a3b8');
  doc.text('Powered by spaitrace.com', innerX, y + h - pad - 10, {
    width: innerW,
    align: 'center',
  });
}

export async function buildVouchersPdf(vouchers, perPage = 6, branding = {}) {
  const layout = PDF_LAYOUTS[perPage] || PDF_LAYOUTS[6];
  const usableW = PAGE_W - MARGIN * 2;
  const usableH = PAGE_H - MARGIN * 2;
  const cellW = usableW / layout.cols;
  const cellH = usableH / layout.rows;
  const assets = await loadBrandingAssets(branding);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (vouchers.length === 0) {
      doc.addPage();
      drawTextBrand(doc, MARGIN, MARGIN, PAGE_W - MARGIN * 2, assets, 18);
      doc
        .font('Helvetica')
        .fontSize(12)
        .fillColor(MUTED)
        .text('No vouchers match your filters.', MARGIN, MARGIN + 28, {
          width: PAGE_W - MARGIN * 2,
          align: 'center',
        });
      doc.end();
      return;
    }

    for (let i = 0; i < vouchers.length; i += perPage) {
      doc.addPage();
      const pageVouchers = vouchers.slice(i, i + perPage);

      pageVouchers.forEach((voucher, index) => {
        const col = index % layout.cols;
        const row = Math.floor(index / layout.cols);
        drawTicket(doc, voucher, {
          x: MARGIN + col * cellW,
          y: MARGIN + row * cellH,
          w: cellW,
          h: cellH,
        }, assets);
      });
    }

    doc.end();
  });
}
