import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_DIR, '../../../..');

export const COMMUNITY_CATALOG_REPO_ROOT = resolve(REPO_ROOT, '../agirunner-playbooks');
export const COMMUNITY_CATALOG_FIXTURE_REPOSITORY = 'fixtures/agirunner-playbooks';
export const COMMUNITY_CATALOG_FIXTURE_REF = 'main';
export const COMMUNITY_CATALOG_FIXTURE_PORT = 8791;
export const COMMUNITY_CATALOG_FIXTURE_BASE_URL = `http://127.0.0.1:${COMMUNITY_CATALOG_FIXTURE_PORT}`;

export const COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME =
  'agirunner-platform-community-catalog-e2e-postgres';
export const COMMUNITY_CATALOG_POSTGRES_PORT = 55432;
export const COMMUNITY_CATALOG_DATABASE_URL =
  `postgresql://agirunner:agirunner@127.0.0.1:${COMMUNITY_CATALOG_POSTGRES_PORT}/agirunner`;

export const COMMUNITY_CATALOG_ADMIN_API_KEY =
  'ab_admin_defcommunity-catalog-playwright-key';
export const COMMUNITY_CATALOG_JWT_SECRET =
  'community-catalog-playwright-jwt-secret-32-bytes-minimum';
export const COMMUNITY_CATALOG_WEBHOOK_KEY =
  'community-catalog-playwright-webhook-key-32';

export const COMMUNITY_CATALOG_PLATFORM_PORT = 18081;
export const COMMUNITY_CATALOG_DASHBOARD_PORT = 13300;

export const COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT = resolve(
  REPO_ROOT,
  'tmp/community-catalog-playwright-artifacts',
);

export const COMMUNITY_CATALOG_POSTGRES_IMAGE = 'postgres:16-alpine';
export const COMMUNITY_CATALOG_POSTGRES_DB = 'agirunner';
export const COMMUNITY_CATALOG_POSTGRES_USER = 'agirunner';
export const COMMUNITY_CATALOG_POSTGRES_PASSWORD = 'agirunner';

export const COMMUNITY_CATALOG_PLATFORM_URL = `http://localhost:${COMMUNITY_CATALOG_PLATFORM_PORT}`;
export const COMMUNITY_CATALOG_DASHBOARD_URL = `http://localhost:${COMMUNITY_CATALOG_DASHBOARD_PORT}`;

export { REPO_ROOT };
