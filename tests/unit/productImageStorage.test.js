import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    PRODUCT_IMAGE_STORAGE_PROVIDER: 'CLOUDINARY',
    PRODUCT_IMAGE_PUBLIC_BASE_URL: '',
    CLOUDINARY_CLOUD_NAME: 'platform-cloud',
    CLOUDINARY_API_KEY: 'platform-key',
    CLOUDINARY_API_SECRET: 'platform-secret',
    AWS_REGION: 'us-east-1',
    AWS_S3_BUCKET: 'platform-images'
  },
  cloudinaryConfig: vi.fn(),
  uploadStream: vi.fn(),
  cloudinaryDestroy: vi.fn(),
  s3Send: vi.fn(),
  s3Config: null
}));

vi.mock('../../src/config/env.js', () => ({ env: mocks.env }));
vi.mock('cloudinary', () => ({
  v2: {
    config: mocks.cloudinaryConfig,
    uploader: { upload_stream: mocks.uploadStream, destroy: mocks.cloudinaryDestroy }
  }
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(config) {
      mocks.s3Config = config;
    }

    send(command) {
      return mocks.s3Send(command);
    }
  },
  PutObjectCommand: class {
    constructor(input) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class {
    constructor(input) {
      this.input = input;
    }
  }
}));

const { uploadProductImageAsset } = await import('../../src/lib/productImageStorage.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.PRODUCT_IMAGE_STORAGE_PROVIDER = 'CLOUDINARY';
  mocks.env.PRODUCT_IMAGE_PUBLIC_BASE_URL = '';
  mocks.s3Config = null;
});

describe('platform-managed product image storage', () => {
  it('uses the platform Cloudinary configuration and never accepts a company provider', async () => {
    mocks.uploadStream.mockImplementation((options, callback) => ({
      end: () => callback(null, {
        secure_url: 'https://res.cloudinary.com/platform/image/upload/products/photo.jpg',
        public_id: options.public_id
      })
    }));

    const uploaded = await uploadProductImageAsset({
      companyId: 'company-1',
      productId: 'product-1',
      buffer: Buffer.from('image'),
      contentType: 'image/jpeg',
      extension: 'jpg'
    });

    expect(uploaded).toMatchObject({
      provider: 'CLOUDINARY',
      imageUrl: 'https://res.cloudinary.com/platform/image/upload/products/photo.jpg'
    });
    expect(mocks.cloudinaryConfig).toHaveBeenCalledWith({
      cloud_name: 'platform-cloud',
      api_key: 'platform-key',
      api_secret: 'platform-secret'
    });
    expect(mocks.uploadStream.mock.calls[0][0].public_id).toMatch(/^products\/[0-9a-f-]{36}$/);
  });

  it('uses the platform S3 bucket and CDN URL when S3 is selected', async () => {
    mocks.env.PRODUCT_IMAGE_STORAGE_PROVIDER = 'S3';
    mocks.env.PRODUCT_IMAGE_PUBLIC_BASE_URL = 'https://images.example.com/';
    mocks.s3Send.mockResolvedValue({});

    const uploaded = await uploadProductImageAsset({
      companyId: 'company-1',
      productId: 'product-1',
      buffer: Buffer.from('image'),
      contentType: 'image/png',
      extension: 'png'
    });

    expect(uploaded).toMatchObject({
      provider: 'S3',
      imageUrl: expect.stringMatching(/^https:\/\/images\.example\.com\/products\/[0-9a-f-]{36}\.png$/)
    });
    expect(mocks.s3Config).toEqual({ region: 'us-east-1' });
    expect(mocks.s3Send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'platform-images',
      ContentType: 'image/png',
      ServerSideEncryption: 'AES256'
    });
  });
});
