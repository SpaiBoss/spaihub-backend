import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_LOGOS_DIR = path.join(__dirname, '../../uploads/logos');

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

// {ownerId}.png or {ownerId}-{timestamp}.png
export const LOGO_FILENAME_RE = /^[0-9a-f-]{36}(?:-\d+)?\.(png|jpe?g|webp)$/i;
export const LOGO_KEY_RE = /^logos\/[0-9a-f-]{36}(?:-\d+)?\.(png|jpe?g|webp)$/i;

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

function contentTypeForExt(ext) {
  return CONTENT_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

function logoObjectKey(ownerId, ext) {
  return `logos/${ownerId}-${Date.now()}.${ext}`;
}

function ownerLogoPrefix(ownerId) {
  return `logos/${ownerId}`;
}

function storedKeyFromLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  if (LOGO_KEY_RE.test(logoUrl)) return logoUrl;

  if (logoUrl.startsWith('/uploads/logos/')) {
    return `logos/${path.basename(logoUrl)}`;
  }

  const mediaMatch = logoUrl.match(/\/media\/(logos\/[0-9a-f-]{36}(?:-\d+)?\.(?:png|jpe?g|webp))(?:\?.*)?$/i);
  if (mediaMatch) return mediaMatch[1];

  const publicBase = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (publicBase && logoUrl.startsWith(`${publicBase}/`)) {
    const key = logoUrl.slice(publicBase.length + 1).split('?')[0];
    if (LOGO_KEY_RE.test(key)) return key;
  }

  try {
    const parsed = new URL(logoUrl);
    const match = parsed.pathname.match(/\/(logos\/[0-9a-f-]{36}(?:-\d+)?\.(?:png|jpe?g|webp))$/i);
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
  return LOGO_FILENAME_RE.test(filename);
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

async function deleteAllOwnerLogosFromR2(ownerId) {
  const bucket = process.env.R2_BUCKET.trim();
  const prefix = ownerLogoPrefix(ownerId);
  const listed = await getS3Client().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
  );
  const keys = (listed.Contents || []).map((item) => item.Key).filter(Boolean);
  if (keys.length === 0) return;

  await getS3Client().send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    })
  );
}

async function deleteAllOwnerLogosLocally(ownerId) {
  const files = await fs.readdir(LOCAL_LOGOS_DIR).catch(() => []);
  const prefix = `${ownerId}`;
  await Promise.all(
    files
      .filter((name) => name.startsWith(prefix) && LOGO_FILENAME_RE.test(name))
      .map((name) => fs.unlink(path.join(LOCAL_LOGOS_DIR, name)).catch(() => {}))
  );
}

export async function deleteAllOwnerLogos(ownerId) {
  if (isR2Configured()) {
    await deleteAllOwnerLogosFromR2(ownerId).catch(() => {});
    return;
  }
  await deleteAllOwnerLogosLocally(ownerId);
}

async function uploadLogoToR2(ownerId, buffer, ext) {
  await deleteAllOwnerLogosFromR2(ownerId);
  const key = logoObjectKey(ownerId, ext);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET.trim(),
      Key: key,
      Body: buffer,
      ContentType: contentTypeForExt(ext),
      CacheControl: 'public, max-age=3600',
    })
  );
  return key;
}

async function uploadLogoLocally(ownerId, buffer, ext) {
  await deleteAllOwnerLogosLocally(ownerId);
  await fs.mkdir(LOCAL_LOGOS_DIR, { recursive: true });
  const filename = `${ownerId}-${Date.now()}.${ext}`;
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

export async function deleteOwnerLogo(logoUrl) {
  if (!logoUrl) return;

  const key = storedKeyFromLogoUrl(logoUrl);
  if (key && isR2Configured()) {
    await deleteLogoFromR2(key).catch(() => {});
    return;
  }

  if (logoUrl.startsWith('/uploads/logos/')) {
    const filepath = path.join(LOCAL_LOGOS_DIR, path.basename(logoUrl));
    await fs.unlink(filepath).catch(() => {});
  }
}

export function getStorageMode() {
  return isR2Configured() ? 'r2' : 'local';
}
