import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCHEDULED_TRIGGER_SOURCE,
  buildScheduledTriggerPayload,
  canSaveScheduledTrigger,
  createScheduledTriggerFormState,
  describeTriggerHealth,
  formatCadence,
  hydrateScheduledTriggerForm,
} from './project-scheduled-trigger-support.js';

describe('project-scheduled-trigger support', () => {
  it('creates a default form state with the canonical source', () => {
    expect(createScheduledTriggerFormState()).toMatchObject({
      source: DEFAULT_SCHEDULED_TRIGGER_SOURCE,
      cadenceMinutes: '60',
      workflowId: '',
      title: '',
    });
  });

  it('hydrates an edit form from a stored trigger record', () => {
    expect(
      hydrateScheduledTriggerForm({
        id: 'trigger-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Daily triage',
        source: 'project.schedule',
        cadence_minutes: 90,
        next_fire_at: '2026-03-12T18:30:00.000Z',
        is_active: true,
        defaults: {
          title: 'Run triage',
          stage_name: 'plan',
          column_id: 'todo',
          owner_role: 'orchestrator',
          priority: 'high',
          goal: 'Keep backlog current',
          acceptance_criteria: 'All new issues triaged',
          notes: 'Created by smoke lane',
        },
        last_fired_at: null,
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T01:00:00.000Z',
      }),
    ).toMatchObject({
      name: 'Daily triage',
      workflowId: 'workflow-1',
      cadenceMinutes: '90',
      title: 'Run triage',
      stageName: 'plan',
      columnId: 'todo',
      ownerRole: 'orchestrator',
      priority: 'high',
      goal: 'Keep backlog current',
      acceptanceCriteria: 'All new issues triaged',
      notes: 'Created by smoke lane',
      nextFireAt: '2026-03-12T18:30',
    });
  });

  it('builds a normalized trigger payload and reports save readiness', () => {
    const payload = buildScheduledTriggerPayload('project-1', {
      name: ' Daily triage ',
      source: '',
      workflowId: 'workflow-1',
      cadenceMinutes: '120',
      title: ' Review inbox ',
      stageName: 'plan',
      columnId: 'todo',
      ownerRole: 'orchestrator',
      priority: 'critical',
      goal: 'Keep backlog under control',
      acceptanceCriteria: 'Every issue triaged',
      notes: 'Use the real workflow',
      nextFireAt: '2026-03-12T18:30',
    });

    expect(payload).toEqual({
      name: 'Daily triage',
      source: DEFAULT_SCHEDULED_TRIGGER_SOURCE,
      project_id: 'project-1',
      workflow_id: 'workflow-1',
      cadence_minutes: 120,
      next_fire_at: new Date('2026-03-12T18:30').toISOString(),
      defaults: {
        title: 'Review inbox',
        stage_name: 'plan',
        column_id: 'todo',
        owner_role: 'orchestrator',
        priority: 'critical',
        goal: 'Keep backlog under control',
        acceptance_criteria: 'Every issue triaged',
        notes: 'Use the real workflow',
      },
    });

    expect(
      canSaveScheduledTrigger({
        ...createScheduledTriggerFormState(),
        name: 'Daily triage',
        workflowId: 'workflow-1',
        title: 'Run triage',
      }),
    ).toBe(true);
  });

  it('describes trigger posture and cadence for operators', () => {
    expect(formatCadence(30)).toBe('Every 30 min');
    expect(formatCadence(120)).toBe('Every 2 hr');
    expect(
      describeTriggerHealth({
        id: 'trigger-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Daily triage',
        source: 'project.schedule',
        cadence_minutes: 60,
        next_fire_at: '2999-01-01T00:00:00.000Z',
        is_active: true,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      }),
    ).toEqual({ label: 'Scheduled', variant: 'success' });
  });
});
