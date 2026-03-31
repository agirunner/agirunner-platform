import type { DatabasePool } from '../../db/database.js';
import { LEVEL_ORDER } from './log-levels.js';

const DEFAULT_LOG_LEVEL = 'debug';
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  level: string;
  expiresAt: number;
}

/**
 * Caches per-tenant log levels from tenants.settings.logging.level.
 * Falls back to the system default when no override is configured.
 * Cache entries expire after 60 seconds to pick up dashboard changes.
 */
export class LogLevelCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly defaultLevel: string;

  constructor(
    private readonly pool: DatabasePool,
    defaultLevel?: string,
  ) {
    this.defaultLevel = defaultLevel ?? DEFAULT_LOG_LEVEL;
  }

  async shouldWrite(tenantId: string, entryLevel: string): Promise<boolean> {
    const threshold = await this.getLevel(tenantId);
    const thresholdOrder = LEVEL_ORDER[threshold] ?? LEVEL_ORDER.info;
    const entryOrder = LEVEL_ORDER[entryLevel] ?? LEVEL_ORDER.info;
    return entryOrder >= thresholdOrder;
  }

  async getLevel(tenantId: string): Promise<string> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.level;
    }

    const level = await this.fetchLevel(tenantId);
    this.cache.set(tenantId, {
      level,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return level;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async fetchLevel(tenantId: string): Promise<string> {
    try {
      const result = await this.pool.query<{ level: string | null }>(
        `SELECT settings->'logging'->>'level' AS level FROM tenants WHERE id = $1`,
        [tenantId],
      );
      const row = result.rows[0];
      if (row?.level && LEVEL_ORDER[row.level] !== undefined) {
        return row.level;
      }
    } catch {
      // DB errors fall through to default — never block log writes
    }
    return this.defaultLevel;
  }
}
