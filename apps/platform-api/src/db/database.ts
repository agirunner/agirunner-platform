import type { Pool, PoolClient } from 'pg';

export interface DatabaseQueryable {
  query: Pool['query'];
}

export interface DatabasePool extends DatabaseQueryable {
  connect: Pool['connect'];
}

export interface DatabaseClient extends DatabaseQueryable {
  on: PoolClient['on'];
  removeAllListeners: PoolClient['removeAllListeners'];
  release: PoolClient['release'];
}
