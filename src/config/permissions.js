export const permissions = Object.freeze({
  ADMIN: [
    'company:read', 'company:update', 'members:read', 'members:manage',
    'products:read', 'products:create', 'products:update', 'products:archive',
    'batches:read', 'batches:create', 'batches:update', 'items:read',
    'items:generate', 'items:revoke', 'codes:export', 'verification-policy:manage',
    'billing:read', 'billing:manage', 'reports:read'
  ],
  PRODUCT_MANAGER: [
    'company:read', 'products:read', 'products:create', 'products:update',
    'batches:read', 'batches:create', 'batches:update', 'items:read',
    'items:generate', 'reports:read'
  ],
  EDITOR: [
    'company:read', 'products:read', 'products:update',
    'batches:read', 'batches:update', 'items:read', 'reports:read'
  ]
});

export function roleHasPermission(role, permission) {
  return permissions[role]?.includes(permission) ?? false;
}

export const platformPermissions = Object.freeze({
  SUPER_ADMIN: [
    'platform:members:read', 'platform:members:manage', 'companies:read',
    'companies:manage', 'audit:read', 'plans:read', 'plans:manage',
    'subscriptions:manage'
  ],
  PLATFORM_ADMIN: [
    'platform:members:read', 'platform:members:manage', 'companies:read',
    'companies:manage', 'audit:read', 'plans:read', 'plans:manage',
    'subscriptions:manage'
  ],
  PLATFORM_SUPPORT: ['companies:read', 'audit:read'],
  PLATFORM_VIEWER: ['platform:members:read', 'companies:read', 'audit:read', 'plans:read']
});

export function platformRoleHasPermission(role, permission) {
  return platformPermissions[role]?.includes(permission) ?? false;
}
