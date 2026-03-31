import { DEFAULT_TENANT_ID } from '../platform-env.js';
import { ApiRecord, sqlText, sqlUuid } from '../workflows-common.js';
import { queryRows, queryScalarValues } from './runtime.js';

const FIXTURE_WORKSPACE_SLUG_PREFIX = 'workflows-';
const FIXTURE_PLAYBOOK_SLUG_PREFIXES = ['planned-workflows-', 'ongoing-workflows-'] as const;
const TERMINAL_WORKFLOW_STATES = new Set(['completed', 'failed', 'cancelled']);

export function selectFixtureWorkspaceIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.workspaces
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)};
  `);
}

export function selectFixturePlaybookIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.playbooks
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND (
         slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
         OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
       );
  `);
}

export function selectBlockingWorkflows(): ApiRecord[] {
  return queryRows(`
    SELECT id::text, COALESCE(name, '') AS name
      FROM public.workflows
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND state NOT IN (${Array.from(TERMINAL_WORKFLOW_STATES).map(sqlText).join(', ')})
       AND COALESCE(name, '') NOT LIKE 'E2E %'
       AND workspace_id NOT IN (
         SELECT id
           FROM public.workspaces
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
       )
       AND playbook_id NOT IN (
         SELECT id
           FROM public.playbooks
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND (
              slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
              OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
            )
       )
     ORDER BY updated_at DESC
     LIMIT 20;
  `).map(([id, name]) => ({ id, name }));
}

export function selectFixtureWorkflowIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.workflows
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND COALESCE(name, '') LIKE 'E2E %'
       AND (
         workspace_id IN (
           SELECT id
             FROM public.workspaces
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND slug LIKE ${sqlText(`${FIXTURE_WORKSPACE_SLUG_PREFIX}%`)}
         )
         OR playbook_id IN (
           SELECT id
             FROM public.playbooks
            WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
              AND (
                slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[0]}%`)}
                OR slug LIKE ${sqlText(`${FIXTURE_PLAYBOOK_SLUG_PREFIXES[1]}%`)}
              )
         )
       );
  `);
}

export function selectTenantWorkflowIds(): string[] {
  return queryScalarValues(`
    SELECT id::text
      FROM public.workflows
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)};
  `);
}
