import nodemailer from 'nodemailer';
import { normalizePreferredLocale } from '../utils/locale.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function baseTemplate(title, body, lang = 'en') {
  return `
    <!DOCTYPE html>
    <html lang="${lang}">
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; background: #f4f6f8; padding: 24px;">
        <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <div style="background: #111827; color: #fff; padding: 24px;">
            <h1 style="margin: 0; font-size: 24px;">SpaiHub</h1>
          </div>
          <div style="padding: 32px 24px;">
            <h2 style="color: #111827; margin-top: 0;">${title}</h2>
            ${body}
          </div>
          <div style="padding: 16px 24px; background: #f8fafc; color: #64748b; font-size: 12px;">
            &copy; ${new Date().getFullYear()} SpaiHub.
          </div>
        </div>
      </body>
    </html>
  `;
}

function btn(href, label) {
  return `<p style="text-align: center; margin: 32px 0;">
         <a href="${href}" style="background: #0F766E; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">${label}</a>
       </p>
       <p style="color: #64748b; font-size: 14px;">${href}</p>`;
}

export async function sendVerificationEmail(email, token, locale) {
  const lang = normalizePreferredLocale(locale);
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  const copy = lang === 'fr'
    ? {
        subject: 'Vérifiez votre compte SpaiHub',
        title: 'Vérifiez votre e-mail',
        body: `<p>Bienvenue sur SpaiHub. Vérifiez votre e-mail pour activer le compte.</p>${btn(verifyUrl, 'Vérifier l’e-mail')}`,
      }
    : {
        subject: 'Verify your SpaiHub account',
        title: 'Verify your email',
        body: `<p>Welcome to SpaiHub! Please verify your email address to activate your account.</p>${btn(verifyUrl, 'Verify Email')}`,
      };
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: copy.subject,
    html: baseTemplate(copy.title, copy.body, lang),
  });
}

export async function sendContributorVerificationEmail(email, token, locale) {
  const lang = normalizePreferredLocale(locale);
  const verifyUrl = `${process.env.FRONTEND_URL}/contributor/verify-email?token=${token}`;
  const copy = lang === 'fr'
    ? {
        subject: 'Vérifiez votre compte contributeur SpaiHub',
        title: 'Vérifiez votre e-mail',
        body: `<p>Bienvenue chez les contributeurs SpaiHub. Vérifiez votre e-mail. Un admin activera ensuite le compte.</p>${btn(verifyUrl, 'Vérifier l’e-mail')}`,
      }
    : {
        subject: 'Verify your SpaiHub contributor account',
        title: 'Verify your email',
        body: `<p>Welcome to SpaiHub Contributors. Please verify your email. After that, a SpaiHub admin will approve your account before you can sign in.</p>${btn(verifyUrl, 'Verify Email')}`,
      };
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: copy.subject,
    html: baseTemplate(copy.title, copy.body, lang),
  });
}

export async function sendContributorPasswordResetEmail(email, token, locale) {
  const lang = normalizePreferredLocale(locale);
  const resetUrl = `${process.env.FRONTEND_URL}/contributor/reset-password?token=${token}`;
  const copy = lang === 'fr'
    ? {
        subject: 'Réinitialiser le mot de passe contributeur SpaiHub',
        title: 'Réinitialiser le mot de passe',
        body: `<p>Demande de réinitialisation (expire dans 1 heure).</p>${btn(resetUrl, 'Réinitialiser')}<p style="color:#64748b;font-size:14px;">Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>`,
      }
    : {
        subject: 'Reset your SpaiHub contributor password',
        title: 'Reset your password',
        body: `<p>We received a request to reset your contributor password. This link expires in 1 hour.</p>${btn(resetUrl, 'Reset Password')}<p style="color:#64748b;font-size:14px;">If you didn't request this, you can safely ignore this email.</p>`,
      };
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: copy.subject,
    html: baseTemplate(copy.title, copy.body, lang),
  });
}

export async function sendPasswordResetEmail(email, token, locale) {
  const lang = normalizePreferredLocale(locale);
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  const copy = lang === 'fr'
    ? {
        subject: 'Réinitialiser votre mot de passe SpaiHub',
        title: 'Réinitialiser le mot de passe',
        body: `<p>Demande de réinitialisation (expire dans 1 heure).</p>${btn(resetUrl, 'Réinitialiser')}<p style="color:#64748b;font-size:14px;">Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>`,
      }
    : {
        subject: 'Reset your SpaiHub password',
        title: 'Reset your password',
        body: `<p>We received a request to reset your password. Click the button below to choose a new password. This link expires in 1 hour.</p>${btn(resetUrl, 'Reset Password')}<p style="color:#64748b;font-size:14px;">If you didn't request this, you can safely ignore this email.</p>`,
      };
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: copy.subject,
    html: baseTemplate(copy.title, copy.body, lang),
  });
}

export async function sendWithdrawalStatusEmail(email, { amountXaf, status, adminNote, locale }) {
  const lang = normalizePreferredLocale(locale);
  const approved = status === 'APPROVED';
  const copy = lang === 'fr'
    ? {
        subject: approved ? 'Votre retrait a été envoyé' : 'Votre retrait a été refusé',
        body: approved
          ? `<p>Votre retrait de <strong>${amountXaf.toLocaleString()} XAF</strong> a été envoyé vers votre Mobile Money.</p>`
          : `<p>Votre demande de retrait de <strong>${amountXaf.toLocaleString()} XAF</strong> a été refusée.</p>${adminNote ? `<p><strong>Motif :</strong> ${adminNote}</p><p>Le montant a été recrédité sur le portefeuille.</p>` : ''}`,
      }
    : {
        subject: approved ? 'Your withdrawal has been approved' : 'Your withdrawal has been rejected',
        body: approved
          ? `<p>Your withdrawal of <strong>${amountXaf.toLocaleString()} XAF</strong> has been sent to your Mobile Money account.</p>`
          : `<p>Your withdrawal request for <strong>${amountXaf.toLocaleString()} XAF</strong> was rejected.</p>${adminNote ? `<p><strong>Reason:</strong> ${adminNote}</p><p>The amount has been refunded to your wallet balance.</p>` : ''}`,
      };

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: copy.subject,
    html: baseTemplate(copy.subject, copy.body, lang),
  });
}

export async function sendOwnerNotificationEmail(email, { title, body }) {
  const safeTitle = String(title || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const safeBody = String(body || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: title,
    html: baseTemplate(safeTitle, `<p>${safeBody}</p>`),
  });
}
