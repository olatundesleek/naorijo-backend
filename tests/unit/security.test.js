import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { permissions, platformPermissions, platformRoleHasPermission, roleHasPermission } from '../../src/config/permissions.js';
import { generateDisplayId, generateVerificationCode, hashSessionToken, hashVerificationCode } from '../../src/utils/crypto.js';

describe('role permissions', () => {
  it('grants sensitive operations only to company Admins', () => {
    expect(roleHasPermission('ADMIN', 'codes:export')).toBe(true);
    expect(roleHasPermission('PRODUCT_MANAGER', 'codes:export')).toBe(false);
    expect(roleHasPermission('EDITOR', 'items:generate')).toBe(false);
    expect(roleHasPermission('EDITOR', 'items:revoke')).toBe(false);
  });

  it('does not define a company verification analyst role', () => {
    expect(Object.keys(permissions)).toEqual(['ADMIN', 'PRODUCT_MANAGER', 'EDITOR']);
  });

  it('keeps platform permissions separate from company permissions', () => {
    expect(platformRoleHasPermission('SUPER_ADMIN', 'platform:members:manage')).toBe(true);
    expect(platformRoleHasPermission('PLATFORM_ADMIN', 'plans:manage')).toBe(true);
    expect(platformRoleHasPermission('PLATFORM_SUPPORT', 'companies:read')).toBe(true);
    expect(platformRoleHasPermission('PLATFORM_SUPPORT', 'plans:manage')).toBe(false);
    expect(platformRoleHasPermission('PLATFORM_VIEWER', 'platform:members:manage')).toBe(false);
    expect(Object.keys(platformPermissions)).toEqual([
      'SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_VIEWER'
    ]);
  });
});

describe('secret token helpers', () => {
  it('generates high-entropy concealed codes and keyed hashes', () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^\d{12}$/);
    expect(hashVerificationCode(code)).toHaveLength(64);
    expect(hashVerificationCode(code)).toBe(hashVerificationCode(code));
  });

  it('generates readable prefixed display IDs', () => {
    expect(generateDisplayId('PI')).toMatch(/^PI\d{12}$/);
    expect(generateDisplayId('US')).toMatch(/^US\d{12}$/);
  });

  it('keys stored session-token hashes and never returns the raw token', () => {
    const token = 'opaque-random-session-token';
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toHaveLength(64);
  });
});

describe('HTTP application shell', () => {
  it('serves health and uses structured not-found errors', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
    const response = await request(app).get('/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
