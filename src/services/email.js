import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function baseTemplate(title, body) {
  return `
    <!DOCTYPE html>
    <html>
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
            &copy; ${new Date().getFullYear()} SpaiHub. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function sendVerificationEmail(email, token) {
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: 'Verify your SpaiHub account',
    html: baseTemplate(
      'Verify your email',
      `<p>Welcome to SpaiHub! Please verify your email address to activate your account.</p>
       <p style="text-align: center; margin: 32px 0;">
         <a href="${verifyUrl}" style="background: #5463FF; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Verify Email</a>
       </p>
       <p style="color: #64748b; font-size: 14px;">If the button doesn't work, copy this link: ${verifyUrl}</p>`
    ),
  });
}

export async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: 'Reset your SpaiHub password',
    html: baseTemplate(
      'Reset your password',
      `<p>We received a request to reset your password. Click the button below to choose a new password. This link expires in 1 hour.</p>
       <p style="text-align: center; margin: 32px 0;">
         <a href="${resetUrl}" style="background: #5463FF; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
       </p>
       <p style="color: #64748b; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>`
    ),
  });
}

export async function sendWithdrawalStatusEmail(email, { amountXaf, status, adminNote }) {
  const subject =
    status === 'APPROVED'
      ? 'Your withdrawal has been approved'
      : 'Your withdrawal has been rejected';

  const body =
    status === 'APPROVED'
      ? `<p>Your withdrawal of <strong>${amountXaf.toLocaleString()} XAF</strong> has been sent to your Mobile Money account.</p>`
      : `<p>Your withdrawal request for <strong>${amountXaf.toLocaleString()} XAF</strong> was rejected.</p>
         ${adminNote ? `<p><strong>Reason:</strong> ${adminNote}</p><p>The amount has been refunded to your wallet balance.</p>` : ''}`;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject,
    html: baseTemplate(subject, body),
  });
}
