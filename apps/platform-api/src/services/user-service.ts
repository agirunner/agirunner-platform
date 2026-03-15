import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import type { RbacRole } from '../auth/rbac.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';

const emailSchema = z.string().email().max(255);

const createUserSchema = z.object({
  email: emailSchema,
  displayName: z.string().min(1).max(200).optional(),
  role: z.enum(['viewer', 'operator', 'agent_admin', 'workflow_admin', 'org_admin']).default('viewer'),
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  role: z.enum(['viewer', 'operator', 'agent_admin', 'workflow_admin', 'org_admin']).optional(),
  isActive: z.boolean().optional(),
});

export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

interface UserRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string | null;
  display_name: string | null;
  role: RbacRole;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SafeUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string | null;
  role: RbacRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UserService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listUsers(tenantId: string): Promise<SafeUser[]> {
    const result = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at',
      [tenantId],
    );
    return result.rows.map(toSafeUser);
  }

  async getUserById(tenantId: string, userId: string): Promise<SafeUser> {
    const result = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE id = $1 AND tenant_id = $2',
      [userId, tenantId],
    );
    if (!result.rowCount) throw new NotFoundError('User not found');
    return toSafeUser(result.rows[0]);
  }

  async createUser(tenantId: string, input: CreateUserInput): Promise<SafeUser> {
    const validated = createUserSchema.parse(input);

    const existing = await this.pool.query(
      'SELECT id FROM users WHERE tenant_id = $1 AND email = $2',
      [tenantId, validated.email],
    );
    if (existing.rowCount) throw new ConflictError('Email already registered');

    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (tenant_id, email, display_name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, validated.email, validated.displayName ?? null, validated.role],
    );
    return toSafeUser(result.rows[0]);
  }

  async updateUser(tenantId: string, userId: string, input: UpdateUserInput): Promise<SafeUser> {
    const validated = updateUserSchema.parse(input);
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, userId];
    let paramIndex = 3;

    if (validated.displayName !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      values.push(validated.displayName);
    }
    if (validated.role !== undefined) {
      setClauses.push(`role = $${paramIndex++}`);
      values.push(validated.role);
    }
    if (validated.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex++}`);
      values.push(validated.isActive);
    }

    if (setClauses.length === 0) {
      return this.getUserById(tenantId, userId);
    }

    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<UserRow>(
      `UPDATE users SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('User not found');
    return toSafeUser(result.rows[0]);
  }

  async deactivateUser(tenantId: string, userId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE tenant_id = $1 AND id = $2',
      [tenantId, userId],
    );
    if (!result.rowCount) throw new NotFoundError('User not found');
  }

  async findOrCreateFromSSO(
    tenantId: string,
    provider: string,
    providerUserId: string,
    providerEmail: string,
    displayName?: string,
  ): Promise<SafeUser> {
    const identityResult = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2',
      [provider, providerUserId],
    );

    if (identityResult.rowCount) {
      const userId = identityResult.rows[0].user_id;
      await this.pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
      return this.getUserById(tenantId, userId);
    }

    const existingUser = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE tenant_id = $1 AND email = $2',
      [tenantId, providerEmail],
    );

    let userId: string;

    if (existingUser.rowCount) {
      userId = existingUser.rows[0].id;
    } else {
      const newUser = await this.pool.query<UserRow>(
        `INSERT INTO users (tenant_id, email, display_name, role)
         VALUES ($1, $2, $3, 'viewer') RETURNING *`,
        [tenantId, providerEmail, displayName ?? null],
      );
      userId = newUser.rows[0].id;
    }

    await this.pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email)
       VALUES ($1, $2, $3, $4)`,
      [userId, provider, providerUserId, providerEmail],
    );

    await this.pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
    return this.getUserById(tenantId, userId);
  }
}
