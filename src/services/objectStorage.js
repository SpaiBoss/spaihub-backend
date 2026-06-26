import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_LOGOS_DIR = path.join(__dirname, '../../uploads/logos');

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const SAFE_LOGO_FILE = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

let s3Client = null;

function r2Endpoint() {
  const raw = process.env.R2_ENDPOINT?.trim() || '';
  return raw.replace(/\/+$/, '').replace(/\/spaihub$/i, '');
}

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID?.trim()
    && process.env.R2_SECRET_ACCESS_KEY?.trim()
    && r2Endpoint()
    && process.env.R2_BUCKET?.trim()
  );
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: r2Endpoint(),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
      },
    });
  }
  return s3Client;
}

function logoObjectKey(ownerId, ext) {
  return `logos/${ownerId}.${ext}`;
}

function contentTypeForExt(ext) {
  return CONTENT_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

function storedKeyFromLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('logos/')) return logoUrl;

  if (logoUrl.startsWith('/uploads/logos/')) {
    return `logos/${path.basename(logoUrl)}`;
  }

  const mediaMatch = logoUrl.match(/\/media\/(logos\/[0-9a-f-]{36}\.(?:png|jpe?g|webp))$/i);
  if (mediaMatch) return mediaMatch[1];

  const publicBase = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (publicBase && logoUrl.startsWith(`${publicBase}/`)) {
    return logoUrl.slice(publicBase.length + 1);
  }

  try {
    const parsed = new URL(logoUrl);
    const match = parsed.pathname.match(/\/(logos\/[0-9a-f-]{36}\.(?:png|jpe?g|webp))$/i);
    if (match) return match[1];
  } catch {
    return null;
  }

  return null;
}

async function readLogoFromR2(key) {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET.trim(),
      Key: key,
    })
  );
  const bytes = await response.Body.transformToByteArray();
  return {
    buffer: Buffer.from(bytes),
    contentType: response.ContentType || contentTypeForExt(path.extname(key).slice(1)),
  };
}

async function readLogoLocally(filename) {
  const filepath = path.join(LOCAL_LOGOS_DIR, filename);
  const buffer = await fs.readFile(filepath);
  return {
    buffer,
    contentType: contentTypeForExt(path.extname(filename).slice(1)),
  };
}

export function isSafeLogoFilename(filename) {
  return SAFE_LOGO_FILE.test(filename);
}

export async function readOwnerLogoFile(filename) {
  const key = `logos/${filename}`;
  if (isR2Configured()) {
    return readLogoFromR2(key);
  }
  return readLogoLocally(filename);
}

export async function readOwnerLogo(storedLogoUrl) {
  const key = storedKeyFromLogoUrl(storedLogoUrl);
  if (!key) return null;

  const filename = path.basename(key);
  if (isR2Configured()) {
    try {
      return await readLogoFromR2(key);
    } catch {
      return null;
    }
  }

  try {
    return await readLogoLocally(filename);
  } catch {
    return null;
  }
}

async function uploadLogoToR2(ownerId, buffer, ext) {
  const key = logoObjectKey(ownerId, ext);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET.trim(),
      Key: key,
      Body: buffer,
      ContentType: contentTypeForExt(ext),
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return key;
}

async function uploadLogoLocally(ownerId, buffer, ext) {
  await fs.mkdir(LOCAL_LOGOS_DIR, { recursive: true });
  const filename = `${ownerId}.${ext}`;
  await fs.writeFile(path.join(LOCAL_LOGOS_DIR, filename), buffer);
  return `/uploads/logos/${filename}`;
}

export async function uploadOwnerLogo(ownerId, buffer, ext) {
  if (isR2Configured()) {
    return uploadLogoToR2(ownerId, buffer, ext);
  }
  return uploadLogoLocally(ownerId, buffer, ext);
}

async function deleteLogoFromR2(key) {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET.trim(),
      Key: key,
    })
  );
}

async function deleteLogoLocally(logoUrl) {
  if (!logoUrl?.startsWith('/uploads/logos/')) return;
  const filepath = path.join(LOCAL_LOGOS_DIR, path.basename(logoUrl));
  await fs.unlink(filepath).catch(() => {});
}

export async function deleteOwnerLogo(logoUrl) {
  if (!logoUrl) return;

  const key = storedKeyFromLogoUrl(logoUrl);
  if (key && isR2Configured()) {
    await deleteLogoFromR2(key).catch(() => {});
    return;
  }

  await deleteLogoLocally(logoUrl);
}

export function getStorageMode() {
  return isR2Configured() ? 'r2' : 'local';
}
