import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

let client;
function s3() {
  if (!process.env.S3_BUCKET) throw Object.assign(new Error('S3_BUCKET is not configured.'), { status: 503 });
  client ||= new S3Client({ region: process.env.AWS_REGION || 'ap-south-1', endpoint: process.env.S3_ENDPOINT || undefined });
  return client;
}
const SAFE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function uploadProductObject(buffer, contentType, originalName = 'image') {
  // originalName is client-supplied, so its extension is untrusted — multer's
  // fileFilter already restricts the actual MIME type to JPEG/PNG/WEBP, but
  // that doesn't stop someone naming the upload "photo.exe" or "a.php" and
  // having that extension land unexamined in a public S3 key/URL. Only ever
  // use an extension from the same known-safe set, falling back to .jpg for
  // anything else — never propagate an arbitrary client-supplied suffix.
  const requestedExt = path.extname(originalName).toLowerCase();
  const ext = SAFE_EXTENSIONS.has(requestedExt) ? requestedExt : '.jpg';
  const key = `products/${new Date().getUTCFullYear()}/${crypto.randomUUID()}${ext}`;
  await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType, CacheControl: 'public,max-age=31536000,immutable' }));
  const base = process.env.S3_PUBLIC_BASE_URL || `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`;
  return `${base.replace(/\/$/, '')}/${key}`;
}
