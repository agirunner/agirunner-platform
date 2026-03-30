import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from '../../tests/e2e/support/platform-env.js';
import { resetWorkflowsState } from '../../tests/e2e/support/workflows-fixture-reset.js';
import { seedWorkflowsScenario } from '../../tests/e2e/support/workflows-fixtures.js';

describe('seedWorkflowsScenario', () => {
  afterEach(async () => {
    await resetWorkflowsState();
  });

  it('does not create live workflow activations for seeded fixture workflows', async () => {
    await seedWorkflowsScenario();

    expect(countFixtureWorkflowActivations()).toBe(0);
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
