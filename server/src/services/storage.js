// File storage for report photos and SOS voice messages.
// Local disk in development; S3 (server-side encrypted) when S3_BUCKET is set.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { one } from '../db/index.js';

export const RECORD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export const VOICE_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };

// Check the first bytes, not just the declared type, so a renamed file is refused.
const MAGIC = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'audio/webm': (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  'audio/ogg': (b) => b.subarray(0, 4).toString('latin1') === 'OggS',
  'audio/mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'audio/aac': (b) => b[0] === 0xff && (b[1] & 0xf6) === 0xf0,
  'audio/mpeg': (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
};

export function baseMime(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

export function checkUpload(buffer, contentType, allowed) {
  const mime = baseMime(contentType);
  if (!allowed[mime]) return { error: 'This file type is not allowed.' };
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return { error: 'The file is empty.' };
  if (!MAGIC[mime]?.(buffer)) return { error: 'The file content does not match its type.' };
  return { mime, ext: allowed[mime] };
}

let s3 = null;
async function s3Client() {
  if (!s3) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3 = new S3Client({ region: config.s3Region });
  }
  return s3;
}

export async function saveFile({ buffer, mime, ext, kind, ownerId }) {
  const key = `${kind}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  let storage = 'local';
  if (config.s3Bucket) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3Client()).send(
      new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, Body: buffer, ContentType: mime, ServerSideEncryption: 'AES256' }),
    );
    storage = 's3';
  } else {
    const full = path.join(config.uploadDir, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer, { mode: 0o600 });
  }
  return one(
    `INSERT INTO files (owner_id, kind, storage, storage_key, mime, size_bytes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [ownerId ?? null, kind, storage, key, mime, buffer.length],
  );
}

// Sends the file to the response: streamed from disk, or a short-lived S3 link.
export async function sendFile(res, file) {
  res.set('Cache-Control', 'private, max-age=300');
  res.set('X-Content-Type-Options', 'nosniff');
  if (file.storage === 's3') {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(await s3Client(), new GetObjectCommand({ Bucket: config.s3Bucket, Key: file.storage_key }), { expiresIn: 300 });
    return res.json({ url });
  }
  const full = path.resolve(config.uploadDir, file.storage_key);
  if (!full.startsWith(path.resolve(config.uploadDir) + path.sep) || !fs.existsSync(full)) return res.status(404).json({ error: 'File not found' });
  res.type(file.mime);
  fs.createReadStream(full).pipe(res);
}
