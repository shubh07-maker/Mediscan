import crypto from "node:crypto";
import nodemailer from "nodemailer";

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 10 * 60 * 1000);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_RESEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_MS || 30 * 1000);
const OTP_RATE_LIMIT_WINDOW_MS = Number(process.env.OTP_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const OTP_RATE_LIMIT_MAX_PER_IP = Number(process.env.OTP_RATE_LIMIT_MAX_PER_IP || 10);
const OTP_RATE_LIMIT_MAX_PER_EMAIL = Number(process.env.OTP_RATE_LIMIT_MAX_PER_EMAIL || 5);
const OTP_SECRET = process.env.OTP_SECRET || "mediscan-otp-secret";

const otpStore = new Map();
const otpRateIpStore = new Map();
const otpRateEmailStore = new Map();

function createOtpGuardError(message, retryAfterSec) {
  const error = new Error(message);
  error.code = "OTP_GUARD";
  error.statusCode = 429;
  error.retryAfterSec = Math.max(1, Number(retryAfterSec || 1));
  return error;
}

function hashOtp(email, otp) {
  return crypto.createHash("sha256").update(`${email}:${otp}:${OTP_SECRET}`).digest("hex");
}

function cleanupExpiredOtps() {
  const now = Date.now();
  for (const [email, entry] of otpStore.entries()) {
    if (entry.expiresAt <= now) otpStore.delete(email);
  }
}

function cleanupRateStore(rateStore, windowMs) {
  const now = Date.now();
  for (const [key, entry] of rateStore.entries()) {
    if (now - entry.windowStart >= windowMs) {
      rateStore.delete(key);
    }
  }
}

function consumeRateLimit(rateStore, key, maxInWindow, windowMs, label) {
  cleanupRateStore(rateStore, windowMs);
  const now = Date.now();
  const current = rateStore.get(key);

  if (!current || now - current.windowStart >= windowMs) {
    rateStore.set(key, { count: 1, windowStart: now });
    return;
  }

  if (current.count >= maxInWindow) {
    const retryAfterSec = Math.ceil((windowMs - (now - current.windowStart)) / 1000);
    throw createOtpGuardError(`Too many OTP requests for this ${label}. Please try again later.`, retryAfterSec);
  }

  current.count += 1;
  rateStore.set(key, current);
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  );
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

export async function sendOtpEmail({ email, name, otp }) {
  const text = [
    `Hi ${name || "there"},`,
    "",
    `Your MediScan AI login OTP is: ${otp}`,
    `This OTP will expire in ${Math.floor(OTP_TTL_MS / 60000)} minutes.`,
    "",
    "If you did not request this, please ignore this email."
  ].join("\n");

  if (!smtpConfigured()) {
    console.log(`[OTP DEV MODE] ${email} -> ${otp}`);
    return { delivered: false, devMode: true };
  }

  const transporter = createTransport();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Your MediScan AI OTP",
    text
  });

  return { delivered: true, devMode: false };
}

export async function createOtpChallenge({ email, name, requesterIp }) {
  cleanupExpiredOtps();
  const now = Date.now();

  const existing = otpStore.get(email);
  if (existing?.lastSentAt && now - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);
    throw createOtpGuardError("Please wait before requesting another OTP.", retryAfterSec);
  }

  const normalizedIp = String(requesterIp || "unknown");
  consumeRateLimit(otpRateIpStore, normalizedIp, OTP_RATE_LIMIT_MAX_PER_IP, OTP_RATE_LIMIT_WINDOW_MS, "IP");
  consumeRateLimit(otpRateEmailStore, email, OTP_RATE_LIMIT_MAX_PER_EMAIL, OTP_RATE_LIMIT_WINDOW_MS, "email");

  const otp = String(crypto.randomInt(100000, 1000000));
  otpStore.set(email, {
    otpHash: hashOtp(email, otp),
    expiresAt: now + OTP_TTL_MS,
    lastSentAt: now,
    attempts: 0,
    name: name || email.split("@")[0] || "Patient"
  });

  const delivery = await sendOtpEmail({ email, name, otp });

  return {
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    resendCooldownSec: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
    devOtp: delivery.devMode ? otp : undefined
  };
}

export function verifyOtpChallenge({ email, otp, name }) {
  cleanupExpiredOtps();

  const entry = otpStore.get(email);
  if (!entry) {
    throw new Error("OTP not found or expired. Please request a new OTP.");
  }

  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(email);
    throw new Error("Too many incorrect OTP attempts. Please request a new OTP.");
  }

  const providedHash = hashOtp(email, otp);
  if (providedHash !== entry.otpHash) {
    entry.attempts += 1;
    otpStore.set(email, entry);
    throw new Error(`Invalid OTP. ${Math.max(OTP_MAX_ATTEMPTS - entry.attempts, 0)} attempts left.`);
  }

  otpStore.delete(email);

  const userName = name || entry.name || email.split("@")[0] || "Patient";
  const token = Buffer.from(`${email}:${Date.now()}:otp`).toString("base64");

  return {
    token,
    user: {
      name: userName,
      email
    }
  };
}
