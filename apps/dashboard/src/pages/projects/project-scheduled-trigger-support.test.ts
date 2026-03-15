import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCHEDULED_TRIGGER_SOURCE,
  buildScheduledTriggerOverview,
  buildScheduledTriggerPayload,
  canSaveScheduledTrigger,
  createScheduledTriggerFormState,
  describeTriggerHealth,
  formatCadence,
  formatSchedule,
  hydrateScheduledTriggerForm,
  validateScheduledTriggerForm,
} from './project-scheduled-trigger-support.js';

describe('project-scheduled-trigger support', () => {
  it('creates a default form state with interval scheduling and canonical source semantics', () => {
    expect(createScheduledTriggerFormState()).toMatchObject({
      scheduleType: 'interval',
      cadenceMinutes: '60',
      dailyTime: '09:00',
      timezone: 'UTC',
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
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
        next_fire_at: '2026-03-12T18:30:00.000Z',
        is_active: true,
        defaults: {
          title: 'Run triage',
          stage_name: 'plan',
          column_id: 'todo',
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
      scheduleType: 'daily_time',
      cadenceMinutes: '60',
      dailyTime: '09:30',
      timezone: 'America/New_York',
      title: 'Run triage',
      stageName: 'plan',
      columnId: 'todo',
      priority: 'high',
      goal: 'Keep backlog current',
      acceptanceCriteria: 'All new issues triaged',
      notes: 'Created by smoke lane',
    });
  });

  it('builds a normalized interval trigger payload and reports save readiness', () => {
    const payload = buildScheduledTriggerPayload('project-1', {
      name: ' Daily triage ',
      workflowId: 'workflow-1',
      scheduleType: 'interval',
      cadenceMinutes: '120',
      dailyTime: '09:00',
      timezone: 'UTC',
      title: ' Review inbox ',
      stageName: 'plan',
      columnId: 'todo',
      priority: 'critical',
      goal: 'Keep backlog under control',
      acceptanceCriteria: 'Every issue triaged',
      notes: 'Use the real workflow',
    });

    expect(payload).toEqual({
      name: 'Daily triage',
      source: DEFAULT_SCHEDULED_TRIGGER_SOURCE,
      project_id: 'project-1',
      workflow_id: 'workflow-1',
      schedule_type: 'interval',
      cadence_minutes: 120,
      defaults: {
        title: 'Review inbox',
        stage_name: 'plan',
        column_id: 'todo',
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
        scheduleType: 'interval',
        cadenceMinutes: '30',
      }),
    ).toBe(true);
  });

  it('builds a normalized daily schedule payload', () => {
    const payload = buildScheduledTriggerPayload('project-1', {
      ...createScheduledTriggerFormState(),
      name: 'Morning triage',
      workflowId: 'workflow-1',
      scheduleType: 'daily_time',
      dailyTime: '09:30',
      timezone: 'America/New_York',
      title: 'Run morning inbox triage',
    });

    expect(payload).toEqual({
      name: 'Morning triage',
      source: DEFAULT_SCHEDULED_TRIGGER_SOURCE,
      project_id: 'project-1',
      workflow_id: 'workflow-1',
      schedule_type: 'daily_time',
      cadence_minutes: null,
      daily_time: '09:30',
      timezone: 'America/New_York',
      defaults: {
        title: 'Run morning inbox triage',
      },
    });
  });

  it('returns inline validation guidance for missing trigger requirements', () => {
    expect(validateScheduledTriggerForm(createScheduledTriggerFormState())).toEqual({
      fieldErrors: {
        name: 'Enter a schedule name.',
        workflowId: 'Choose the workflow this trigger should target.',
        title: 'Enter the work item title to create on each run.',
      },
      issues: [
        'Enter a schedule name.',
        'Choose the workflow this trigger should target.',
        'Enter the work item title to create on each run.',
      ],
      isValid: false,
    });
    expect(
      validateScheduledTriggerForm({
        ...createScheduledTriggerFormState(),
        name: 'Daily triage',
        workflowId: 'workflow-1',
        title: 'Run triage',
        scheduleType: 'interval',
        cadenceMinutes: '0',
      }).fieldErrors.cadenceMinutes,
    ).toBe('Enter a cadence greater than 0 minutes.');

    expect(
      validateScheduledTriggerForm({
        ...createScheduledTriggerFormState(),
        name: 'Morning triage',
        workflowId: 'workflow-1',
        title: 'Run triage',
        scheduleType: 'daily_time',
        dailyTime: '930',
        timezone: '',
      }).fieldErrors,
    ).toEqual({
      dailyTime: 'Enter a daily time in HH:MM format.',
      timezone: 'Choose a timezone for the daily schedule.',
    });
  });

  it('describes trigger posture and cadence for operators', () => {
    expect(formatCadence(30)).toBe('Every 30 min');
    expect(formatCadence(120)).toBe('Every 2 hr');
    expect(
      formatSchedule({
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
      }),
    ).toBe('Daily at 09:30 (America/New_York)');
    expect(
      describeTriggerHealth({
        id: 'trigger-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Daily triage',
        source: 'project.schedule',
        schedule_type: 'interval',
        cadence_minutes: 60,
        daily_time: null,
        timezone: null,
        next_fire_at: '2999-01-01T00:00:00.000Z',
        is_active: true,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      }),
    ).toEqual({ label: 'Scheduled', variant: 'success' });
  });

  it('builds automation posture packets and next-step guidance', () => {
    const overview = buildScheduledTriggerOverview([
      {
        id: 'trigger-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Daily triage',
        source: 'project.schedule',
        schedule_type: 'interval',
        cadence_minutes: 60,
        daily_time: null,
        timezone: null,
        next_fire_at: '2999-01-01T00:00:00.000Z',
        is_active: true,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
      {
        id: 'trigger-2',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Paused sync',
        source: 'project.schedule',
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
        next_fire_at: '2999-01-02T00:00:00.000Z',
        is_active: false,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
    ]);

    expect(overview.heading).toBe('Automation posture is healthy');
    expect(overview.packets[0]).toMatchObject({
      label: 'Schedule coverage',
      value: '2 schedules',
      detail: '1 active • 1 paused',
    });
    expect(overview.packets[1]).toMatchObject({
      label: 'Attention needed',
      value: '0 due',
    });
    expect(overview.nextAction).toContain('paused schedules');
  });
});
