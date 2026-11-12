import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

let transporter;

function getTransporter() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is not configured');
  }
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
  });
  return transporter;
}

export async function sendEmail({ to, subject, text }) {
  try {
    await getTransporter().sendMail({ from: env.EMAIL_FROM, to, subject, text });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Email delivery failed:', error?.code ?? 'SMTP_ERROR');
    throw new AppError(503, 'EMAIL_DELIVERY_FAILED', 'Email delivery failed; please try again later');
  }
}
