import { describe, expect, it, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

import { UserService } from '../../src/services/user-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000099';

const sampleUserRow = {
  id: USER_ID,
  tenant_id: TENANT_ID,
  email: 'dev@example.com',
  password_hash: null,
  display_name: 'Dev User',
  role: 'viewer' as const,
  is_active: true,
  last_login_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('UserService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: UserService;

  beforeEach(() => {
    pool = createMockPool();
    service = new UserService(pool as never);
  });

  describe('listUsers', () => {
    it('returns all users for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleUserRow], rowCount: 1 });

      const result = await service.listUsers(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('dev@example.com');
      expect(result[0]).not.toHaveProperty('password_hash');
    });
  });

  describe('getUserById', () => {
    it('returns user when found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleUserRow], rowCount: 1 });

      const result = await service.getUserById(TENANT_ID, USER_ID);

      expect(result.id).toBe(USER_ID);
      expect(result.email).toBe('dev@example.com');
    });

    it('throws NotFoundError when user does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.getUserById(TENANT_ID, 'missing')).rejects.toThrow('User not found');
    });
  });

  describe('createUser', () => {
    it('creates user with hashed password', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ ...sampleUserRow, role: 'operator' }], rowCount: 1 });

      const result = await service.createUser(TENANT_ID, {
        email: 'dev@example.com',
        password: 'securepass123',
        displayName: 'Dev User',
        role: 'operator',
      });

      expect(result.email).toBe('dev@example.com');
      const insertCall = pool.query.mock.calls[1];
      const passwordHash = insertCall[1][2] as string;
      expect(passwordHash).toMatch(/^\$2[ab]\$/);
    });

    it('creates user without password for SSO-only', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [sampleUserRow], rowCount: 1 });

      const result = await service.createUser(TENANT_ID, {
        email: 'sso@example.com',
      });

      expect(result.email).toBe('dev@example.com');
      const insertCall = pool.query.mock.calls[1];
      expect(insertCall[1][2]).toBeNull();
    });

    it('throws ConflictError when email already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing' }], rowCount: 1 });

      await expect(
        service.createUser(TENANT_ID, { email: 'dev@example.com', password: 'pass12345678' }),
      ).rejects.toThrow('Email already registered');
    });

    it('rejects invalid email', async () => {
      await expect(
        service.createUser(TENANT_ID, { email: 'not-an-email', password: 'pass12345678' }),
      ).rejects.toThrow();
    });

    it('rejects password shorter than 8 characters', async () => {
      await expect(
        service.createUser(TENANT_ID, { email: 'dev@example.com', password: 'short' }),
      ).rejects.toThrow();
    });
  });

  describe('updateUser', () => {
    it('updates role and display name', async () => {
      const updated = { ...sampleUserRow, role: 'operator' as const, display_name: 'Updated' };
      pool.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await service.updateUser(TENANT_ID, USER_ID, {
        role: 'operator',
        displayName: 'Updated',
      });

      expect(result.role).toBe('operator');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('display_name');
      expect(sql).toContain('role');
    });

    it('throws NotFoundError when user does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        service.updateUser(TENANT_ID, 'missing', { role: 'operator' }),
      ).rejects.toThrow('User not found');
    });
  });

  describe('deactivateUser', () => {
    it('soft-deletes the user', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.deactivateUser(TENANT_ID, USER_ID);

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('is_active = false');
    });

    it('throws NotFoundError when user does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      await expect(service.deactivateUser(TENANT_ID, 'missing')).rejects.toThrow('User not found');
    });
  });

  describe('verifyPassword', () => {
    it('returns user on correct password', async () => {
      const hash = await bcrypt.hash('correctpass', 4);
      const userWithHash = { ...sampleUserRow, password_hash: hash };
      pool.query
        .mockResolvedValueOnce({ rows: [userWithHash], rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.verifyPassword(TENANT_ID, 'dev@example.com', 'correctpass');

      expect(result.email).toBe('dev@example.com');
    });

    it('throws on wrong password', async () => {
      const hash = await bcrypt.hash('correctpass', 4);
      const userWithHash = { ...sampleUserRow, password_hash: hash };
      pool.query.mockResolvedValueOnce({ rows: [userWithHash], rowCount: 1 });

      await expect(
        service.verifyPassword(TENANT_ID, 'dev@example.com', 'wrongpass'),
      ).rejects.toThrow('Invalid credentials');
    });

    it('throws on non-existent user (timing safe)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        service.verifyPassword(TENANT_ID, 'nobody@example.com', 'anything'),
      ).rejects.toThrow('Invalid credentials');
    });

    it('throws on inactive user', async () => {
      const hash = await bcrypt.hash('correctpass', 4);
      const inactiveUser = { ...sampleUserRow, password_hash: hash, is_active: false };
      pool.query.mockResolvedValueOnce({ rows: [inactiveUser], rowCount: 1 });

      await expect(
        service.verifyPassword(TENANT_ID, 'dev@example.com', 'correctpass'),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('changePassword', () => {
    it('updates password hash', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.changePassword(TENANT_ID, USER_ID, 'newpassword123');

      const insertCall = pool.query.mock.calls[0];
      const newHash = insertCall[1][0] as string;
      expect(newHash).toMatch(/^\$2[ab]\$/);
    });

    it('rejects short password', async () => {
      await expect(service.changePassword(TENANT_ID, USER_ID, 'short')).rejects.toThrow();
    });
  });

  describe('findOrCreateFromSSO', () => {
    it('returns existing user when identity exists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ user_id: USER_ID }], rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleUserRow], rowCount: 1 });

      const result = await service.findOrCreateFromSSO(
        TENANT_ID, 'google', 'google-123', 'dev@example.com', 'Dev',
      );

      expect(result.id).toBe(USER_ID);
    });

    it('creates new user when no identity exists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [sampleUserRow], rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleUserRow], rowCount: 1 });

      const result = await service.findOrCreateFromSSO(
        TENANT_ID, 'github', 'gh-456', 'new@example.com', 'New User',
      );

      expect(result.id).toBe(USER_ID);
    });
  });
});
