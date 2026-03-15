import { describe, expect, it } from 'vitest';

import { buildProjectAutomationOverview } from './project-automation-tab.support.js';

describe('project automation tab support', () => {
  it('summarizes active, broken, and setup-needed automation posture for one control center', () => {
    const overview = buildProjectAutomationOverview(
      {
        id: 'project-1',
        name: 'Release automation',
        slug: 'release-automation',
        repository_url: 'https://example.com/repo.git',
        git_webhook_provider: 'github',
        git_webhook_secret_configured: false,
      },
      [
        {
          id: 'schedule-1',
          name: 'Daily release triage',
          project_id: 'project-1',
          workflow_id: 'workflow-1',
          source: 'project.schedule',
          cadence_minutes: 60,
          next_fire_at: '2026-03-12T09:00:00Z',
          is_active: true,
          defaults: {},
        },
      ] as never,
      [
        {
          id: 'hook-1',
          name: 'Git push intake',
          project_id: 'project-1',
          workflow_id: 'workflow-1',
          source: 'github',
          signature_header: 'x-hub-signature-256',
          signature_mode: 'hmac_sha256',
          is_active: true,
          secret_configured: false,
        },
      ] as never,
      new Date('2026-03-12T10:00:00Z'),
    );

    expect(overview.statusLabel).toBe('Automation needs attention');
    expect(overview.tone).toBe('warning');
    expect(overview.signals).toEqual([
      { label: 'Live', value: '2 live', tone: 'success' },
      { label: 'Attention', value: '2 issues', tone: 'warning' },
      { label: 'Setup', value: '1 gap', tone: 'warning' },
    ]);
    expect(overview.packets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Active now', value: '2 lanes live' }),
        expect.objectContaining({ label: 'Broken', value: '2 issues' }),
        expect.objectContaining({ label: 'Setup needed', value: '1 item' }),
      ]),
    );
    expect(overview.nextAction).toContain('overdue schedule');
    expect(
      overview.packets.find((packet) => packet.label === 'Setup needed')?.detail,
    ).toContain('Repository webhook signatures');
  });

  it('reports live automation when schedules, hooks, and repository trust are all configured', () => {
    const overview = buildProjectAutomationOverview(
      {
        id: 'project-1',
        name: 'Release automation',
        slug: 'release-automation',
        repository_url: 'https://example.com/repo.git',
        git_webhook_provider: 'github',
        git_webhook_secret_configured: true,
      },
      [
        {
          id: 'schedule-1',
          name: 'Daily release triage',
          project_id: 'project-1',
          workflow_id: 'workflow-1',
          source: 'project.schedule',
          cadence_minutes: 60,
          next_fire_at: '2026-03-12T11:00:00Z',
          is_active: true,
          defaults: {},
        },
      ] as never,
      [
        {
          id: 'hook-1',
          name: 'Git push intake',
          project_id: 'project-1',
          workflow_id: 'workflow-1',
          source: 'github',
          signature_header: 'x-hub-signature-256',
          signature_mode: 'hmac_sha256',
          is_active: true,
          secret_configured: true,
        },
      ] as never,
      new Date('2026-03-12T10:00:00Z'),
    );

    expect(overview.statusLabel).toBe('Automation is live');
    expect(overview.tone).toBe('success');
    expect(overview.signals).toEqual([
      { label: 'Live', value: '2 live', tone: 'success' },
      { label: 'Attention', value: 'Clear', tone: 'success' },
      { label: 'Setup', value: 'Ready', tone: 'success' },
    ]);
    expect(overview.summary).toContain('repository trust');
    expect(
      overview.packets.find((packet) => packet.label === 'Broken')?.value,
    ).toBe('No active breakage');
    expect(
      overview.packets.find((packet) => packet.label === 'Setup needed')?.value,
    ).toBe('Ready');
  });
});
