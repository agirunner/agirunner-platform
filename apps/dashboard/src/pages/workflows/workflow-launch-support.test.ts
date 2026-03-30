import { describe, expect, it } from 'vitest';

import {
  buildParametersFromDrafts,
  createStructuredEntryDraft,
  readLaunchDefinition,
} from './workflow-launch-support.js';

describe('workflow launch support', () => {
  it('reads only the declared launch input contract from the playbook definition', () => {
    const summary = readLaunchDefinition({
      id: 'pb-1',
      name: 'Ship',
      slug: 'ship',
      outcome: 'Ship software',
      lifecycle: 'ongoing',
      version: 1,
      definition: {
        roles: ['architect', 'developer'],
        board: {
          columns: [
            { id: 'triage', label: 'Triage' },
            { id: 'doing', label: 'Doing' },
          ],
        },
        stages: [
          { name: 'triage', goal: 'Triage new work' },
          { name: 'delivery', goal: 'Deliver the outcome' },
        ],
        parameters: [
          { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
          { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
        ],
      },
    });

    expect(summary.roles).toEqual(['architect', 'developer']);
    expect(summary.stageNames).toEqual(['triage', 'delivery']);
    expect(summary.boardColumns).toEqual([
      { id: 'triage', label: 'Triage' },
      { id: 'doing', label: 'Doing' },
    ]);
    expect(summary.parameterSpecs).toEqual([
      { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
      { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
    ]);
  });

  it('builds workflow parameters from declared launch inputs only', () => {
    const parameters = buildParametersFromDrafts(
      [
        { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
        { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
      ],
      {
        workflow_goal: 'Ship the release candidate',
        acceptance_notes: '',
      },
    );

    expect(parameters).toEqual({
      workflow_goal: 'Ship the release candidate',
    });
  });

  it('creates blank structured drafts for launch-owned structured editors', () => {
    expect(createStructuredEntryDraft()).toMatchObject({
      key: '',
      value: '',
      valueType: 'string',
    });
  });
});
