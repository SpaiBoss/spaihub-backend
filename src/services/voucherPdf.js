import PDFDocument from 'pdfkit';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;

const NAVY = '#1A3C5E';
const BRAND = '#5463FF';
const MUTED = '#64748b';

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
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && !hours) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatPackageLine(pkg) {
  if (!pkg) return '';
  if (pkg.type === 'DATA_BASED') {
    const cap = pkg.dataCapMb >= 1024 ? `${(pkg.dataCapMb / 1024).toFixed(0)}GB` : `${pkg.dataCapMb}MB`;
    return `${cap} data · ${formatDuration(pkg.durationMinutes)} validity`;
  }
  const browse = formatDuration(pkg.durationMinutes);
  const cap = pkg.dataCapMb
    ? pkg.dataCapMb >= 1024
      ? `${(pkg.dataCapMb / 1024).toFixed(0)}GB cap`
      : `${pkg.dataCapMb}MB cap`
    : 'Unlimited data';
  return `${browse} · ${cap}`;
}

function drawWordmark(doc, x, y, size = 14) {
  doc.font('Helvetica-Bold').fontSize(size);
  doc.fillColor(NAVY).text('Spai', x, y, { continued: true });
  doc.fillColor(MUTED).text('-', { continued: true });
  doc.fillColor(BRAND).text('Hub');
}

function drawTicket(doc, voucher, box) {
  const { x, y, w, h } = box;
  const pad = 10;

  doc.save();
  doc.dash(4, { space: 3 }).lineWidth(0.75).strokeColor('#cbd5e1');
  doc.roundedRect(x + 4, y + 4, w - 8, h - 8, 6).stroke();
  doc.undash();
  doc.restore();

  const innerX = x + pad + 4;
  let cursorY = y + pad + 6;
  const innerW = w - pad * 2 - 8;

  drawWordmark(doc, innerX, cursorY, h > 130 ? 13 : 11);
  cursorY += h > 130 ? 20 : 16;

  doc.font('Helvetica').fontSize(h > 130 ? 8 : 7).fillColor(MUTED);
  doc.text(voucher.location.name, innerX, cursorY, { width: innerW });
  cursorY += h > 130 ? 12 : 10;

  doc.font('Helvetica-Bold').fontSize(h > 130 ? 9 : 8).fillColor(NAVY);
  doc.text(voucher.package.name, innerX, cursorY, { width: innerW });
  cursorY += h > 130 ? 12 : 10;

  doc.font('Helvetica').fontSize(7).fillColor(MUTED);
  const detail = formatPackageLine(voucher.package);
  if (detail) {
    doc.text(detail, innerX, cursorY, { width: innerW });
    cursorY += h > 130 ? 11 : 9;
  }

  const codeSize = h > 150 ? 16 : h > 120 ? 14 : h > 90 ? 12 : 10;
  doc.font('Courier-Bold').fontSize(codeSize).fillColor(NAVY);
  doc.text(voucher.code, innerX, cursorY, { width: innerW, align: 'center' });
  cursorY += codeSize + (h > 130 ? 6 : 4);

  if (voucher.pin) {
    doc.font('Helvetica').fontSize(h > 130 ? 8 : 7).fillColor(MUTED);
    doc.text('PIN', innerX, cursorY, { width: innerW, align: 'center' });
    cursorY += h > 130 ? 10 : 8;
    doc.font('Courier-Bold').fontSize(h > 130 ? 14 : 12).fillColor(BRAND);
    doc.text(voucher.pin, innerX, cursorY, { width: innerW, align: 'center' });
    cursorY += h > 130 ? 14 : 10;
  }

  doc.font('Helvetica').fontSize(6.5).fillColor(MUTED);
  const footnotes = [];
  if (voucher.batchLabel) footnotes.push(`Batch: ${voucher.batchLabel}`);
  if (voucher.expiresAt) {
    footnotes.push(`Redeem by ${new Date(voucher.expiresAt).toLocaleDateString()}`);
  }
  footnotes.push('Use code + PIN at WiFi login');
  doc.text(footnotes.join(' · '), innerX, Math.min(cursorY, y + h - pad - 14), {
    width: innerW,
    align: 'center',
  });
}

export function buildVouchersPdf(vouchers, perPage = 6) {
  const layout = PDF_LAYOUTS[perPage] || PDF_LAYOUTS[6];
  const usableW = PAGE_W - MARGIN * 2;
  const usableH = PAGE_H - MARGIN * 2;
  const cellW = usableW / layout.cols;
  const cellH = usableH / layout.rows;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (vouchers.length === 0) {
      doc.addPage();
      drawWordmark(doc, MARGIN, MARGIN, 18);
      doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('No vouchers match your filters.', MARGIN, MARGIN + 28);
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
        });
      });
    }

    doc.end();
  });
}
