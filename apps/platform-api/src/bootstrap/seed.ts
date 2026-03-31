/**
 * Configuration seeding facade.
 *
 * Keep this file thin so callers can continue importing from the stable
 * bootstrap entrypoint while the real implementation lives under
 * `src/bootstrap/seed/`.
 */
export { seedConfigTables } from './seed/config-seed.js';
export { resetPlaybookRedesignState } from './seed/reset-playbook-redesign-state.js';
