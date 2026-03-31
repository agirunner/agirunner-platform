import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ADMIN_API_KEY,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
  PLATFORM_API_URL,
} from '../../../../tests/integration/dashboard/support/platform-env.js';
import { resetWorkflowsState } from '../../../../tests/integration/dashboard/support/workflows-fixture-reset.js';
import { seedWorkflowsScenario } from '../../../../tests/integration/dashboard/support/workflows-fixtures.js';

describe('seedWorkflowsScenario', () => {
  afterEach(async () => {
    await resetWorkflowsState();
  });

  it('does not create live workflow activations for seeded fixture workflows', async () => {
    await seedWorkflowsScenario();

    expect(countFixtureWorkflowActivations()).toBe(0);
    expect(listSpecialistRuntimeContainers()).toEqual([]);
  });

  it('creates a real actionable escalation packet for the seeded needs-action workflow', async () => {
    const scenario = await seedWorkflowsScenario();

    const payload = await fetchJson<{
      data: {
        needs_action: {
          total_count: number;
          items: Array<{
            action_kind: string;
            label: string;
            summary: string;
            details?: Array<{ label: string; value: string }>;
            responses: Array<{ kind: string; label: string }>;
          }>;
        };
      };
    }>(`${PLATFORM_API_URL}/api/v1/operations/workflows/${scenario.needsActionWorkflow.id}/workspace`);

    expect(payload.data.needs_action.total_count).toBeGreaterThan(0);
    expect(payload.data.needs_action.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_kind: 'resolve_escalation',
          label: 'Resolve escalation',
          summary: expect.stringContaining('replay mismatch'),
          details: expect.arrayContaining([
            expect.objectContaining({
              label: 'Conflicting request ids',
              value:
                'Submitted handoff:seeded-submitted; persisted handoff:seeded-persisted; current attempt handoff:seeded-current-attempt',
            }),
            expect.objectContaining({
              label: 'Persisted handoff',
              value:
                'Release summary is already persisted for operator review. (handoff:seeded-persisted, full)',
            }),
            expect.objectContaining({
              label: 'Completion contract',
              value: 'Already satisfied by the persisted handoff.',
            }),
          ]),
          responses: expect.arrayContaining([
            expect.objectContaining({
              kind: 'resolve_escalation',
              label: 'Resume with guidance',
            }),
          ]),
        }),
      ]),
    );
  });
});

function countFixtureWorkflowActivations(): number {
  const sql = `
    SELECT COUNT(*)
      FROM workflow_activations wa
      JOIN workflows w ON w.id = wa.workflow_id
     WHERE w.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
       AND w.name LIKE 'E2E %';
  `;
  const output = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-t',
      '-A',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number.parseInt(output, 10);
}

function listSpecialistRuntimeContainers(): string[] {
  const output = execFileSync(
    'docker',
    ['ps', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  ).trim();
  return output
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.startsWith('runtime-speciali-'));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${ADMIN_API_KEY}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${url}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}
