import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

let s3;

function s3Client() {
  if (!env.AWS_REGION || !env.AWS_S3_BUCKET) {
    throw new AppError(503, 'IMAGE_STORAGE_UNAVAILABLE', 'Product image storage is not configured');
  }
  if (!s3) s3 = new S3Client({ region: env.AWS_REGION });
  return s3;
}

function cloudinaryConfigured() {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

function s3ImageUrl(key) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  if (env.PRODUCT_IMAGE_PUBLIC_BASE_URL) {
    return `${env.PRODUCT_IMAGE_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${encodedKey}`;
  }
  return `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${encodedKey}`;
}

async function uploadToCloudinary({ buffer, contentType, storageKey }) {
  if (!cloudinaryConfigured()) {
    throw new AppError(503, 'IMAGE_STORAGE_UNAVAILABLE', 'Product image storage is not configured');
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET
  });
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      public_id: storageKey,
      resource_type: 'image',
      overwrite: false,
      format: contentType.split('/')[1]
    }, (error, result) => {
      if (error) return reject(error);
      if (!result?.secure_url || !result.public_id) {
        return reject(new Error('Cloudinary returned incomplete image metadata'));
      }
      resolve({ imageUrl: result.secure_url, storageKey: result.public_id });
    });
    stream.end(buffer);
  });
}

async function uploadToS3({ buffer, contentType, storageKey }) {
  const client = s3Client();
  await client.send(new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: storageKey,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    ServerSideEncryption: 'AES256'
  }));
  return { imageUrl: s3ImageUrl(storageKey), storageKey };
}

export async function uploadProductImageAsset({ buffer, contentType, extension }) {
  const provider = env.PRODUCT_IMAGE_STORAGE_PROVIDER;
  const baseKey = `products/${randomUUID()}`;
  try {
    const uploaded = provider === 'CLOUDINARY'
      ? await uploadToCloudinary({ buffer, contentType, storageKey: baseKey })
      : await uploadToS3({ buffer, contentType, storageKey: `${baseKey}.${extension}` });
    return { ...uploaded, provider };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(`Product image upload failed using ${provider}:`, error.message);
    throw new AppError(503, 'IMAGE_UPLOAD_FAILED', 'The product image could not be uploaded');
  }
}

export async function deleteProductImageAsset({ provider, storageKey }) {
  if (!storageKey) return;
  if (provider === 'CLOUDINARY') {
    if (!cloudinaryConfigured()) throw new Error('Cloudinary is not configured');
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET
    });
    const result = await cloudinary.uploader.destroy(storageKey, { resource_type: 'image', invalidate: true });
    if (!['ok', 'not found'].includes(result.result)) throw new Error('Cloudinary did not delete the product image');
    return;
  }
  if (provider === 'S3') {
    const client = s3Client();
    await client.send(new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: storageKey }));
    return;
  }
  throw new Error(`Unsupported product image provider: ${provider}`);
}
