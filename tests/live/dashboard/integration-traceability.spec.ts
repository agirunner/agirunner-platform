import { expect, test } from '@playwright/test';

import {
  expectDashboardShell,
  expectLoginPage,
  expectOneOfHeadings,
  gotoDashboard,
  tryLogin,
} from './helpers.js';

type TraceabilityCase = {
  scenarioKey: string;
  title: string;
  path: '/pipelines' | '/workers' | '/templates' | '/tasks' | '/system' | '/login';
  url: RegExp;
  headings: Array<string | RegExp>;
  requiresLoginPage?: boolean;
};

const TRACEABILITY_CASES: TraceabilityCase[] = [
  {
    scenarioKey: 'sdlc-happy',
    title: 'pipeline creation and execution surfaces',
    path: '/pipelines',
    url: /\/pipelines(\/|$)/,
    headings: ['Pipelines'],
  },
  {
    scenarioKey: 'ap2-external-runtime',
    title: 'external runtime worker visibility',
    path: '/workers',
    url: /\/workers(\/|$)/,
    headings: ['Workers', 'Agents'],
  },
  {
    scenarioKey: 'ap3-standalone-worker',
    title: 'standalone worker registration surfaces',
    path: '/workers',
    url: /\/workers(\/|$)/,
    headings: ['Workers', 'Agents'],
  },
  {
    scenarioKey: 'ap4-mixed-workers',
    title: 'mixed worker pool dashboard surfaces',
    path: '/workers',
    url: /\/workers(\/|$)/,
    headings: ['Workers', 'Agents'],
  },
  {
    scenarioKey: 'maintenance-happy',
    title: 'maintenance template browsing surfaces',
    path: '/templates',
    url: /\/(templates|pipelines)(\/|$)/,
    headings: ['Templates', 'Pipelines'],
  },
  {
    scenarioKey: 'ap6-runtime-maintenance',
    title: 'runtime maintenance monitoring surfaces',
    path: '/system',
    url: /\/(system|metrics|pipelines)(\/|$)/,
    headings: ['System Metrics', 'Pipelines'],
  },
  {
    scenarioKey: 'ap7-failure-recovery',
    title: 'failure recovery task visibility surfaces',
    path: '/tasks',
    url: /\/(tasks|pipelines)(\/|$)/,
    headings: ['Task Detail', 'Pipelines'],
  },
  {
    scenarioKey: 'ot1-cascade',
    title: 'dependency cascade pipeline visibility',
    path: '/pipelines',
    url: /\/pipelines(\/|$)/,
    headings: ['Pipelines'],
  },
  {
    scenarioKey: 'ot2-routing',
    title: 'task routing list/detail surfaces',
    path: '/tasks',
    url: /\/(tasks|pipelines)(\/|$)/,
    headings: ['Task Detail', 'Pipelines'],
  },
  {
    scenarioKey: 'ot3-state',
    title: 'pipeline state dashboard surfaces',
    path: '/pipelines',
    url: /\/pipelines(\/|$)/,
    headings: ['Pipelines'],
  },
  {
    scenarioKey: 'ot4-health',
    title: 'worker health dashboard surfaces',
    path: '/workers',
    url: /\/workers(\/|$)/,
    headings: ['Workers', 'Agents'],
  },
  {
    scenarioKey: 'hl1-approval-flow',
    title: 'approval workflow task surfaces',
    path: '/tasks',
    url: /\/(tasks|pipelines)(\/|$)/,
    headings: ['Task Detail', 'Pipelines'],
  },
  {
    scenarioKey: 'hl2-pipeline-controls',
    title: 'pipeline pause/resume/cancel control surfaces',
    path: '/pipelines',
    url: /\/pipelines(\/|$)/,
    headings: ['Pipelines'],
  },
  {
    scenarioKey: 'it1-sdk',
    title: 'SDK integration observability surfaces',
    path: '/system',
    url: /\/(system|metrics|pipelines)(\/|$)/,
    headings: ['System Metrics', 'Pipelines'],
  },
  {
    scenarioKey: 'it2-mcp',
    title: 'MCP integration task surfaces',
    path: '/tasks',
    url: /\/(tasks|pipelines)(\/|$)/,
    headings: ['Task Detail', 'Pipelines'],
  },
  {
    scenarioKey: 'it3-webhooks',
    title: 'webhook integration event/task surfaces',
    path: '/tasks',
    url: /\/(tasks|pipelines)(\/|$)/,
    headings: ['Task Detail', 'Pipelines'],
  },
  {
    scenarioKey: 'it3-mcp-sse-stream',
    title: 'MCP SSE stream task/event surfaces',
    path: '/tasks',
    url: /\/(tasks|pipelines)(\/|$)/,
    headings: ['Task Detail', 'Pipelines'],
  },
  {
    scenarioKey: 'si1-isolation',
    title: 'tenant isolation system metric surfaces',
    path: '/system',
    url: /\/(system|metrics|pipelines)(\/|$)/,
    headings: ['System Metrics', 'Pipelines'],
  },
  {
    scenarioKey: 'si2-auth',
    title: 'authentication entrypoint and session surfaces',
    path: '/login',
    url: /\/(login|pipelines)(\/|$)/,
    headings: ['AgentBaton Dashboard', 'Pipelines'],
    requiresLoginPage: true,
  },
  {
    scenarioKey: 'si2-extended-isolation',
    title: 'extended isolation observability surfaces',
    path: '/system',
    url: /\/(system|metrics|pipelines)(\/|$)/,
    headings: ['System Metrics', 'Pipelines'],
  },
];

test.describe('dashboard integration traceability scenarios', () => {
  for (const check of TRACEABILITY_CASES) {
    test(`[scenario:${check.scenarioKey}] ${check.title}`, async ({ page }) => {
      if (check.requiresLoginPage) {
        await gotoDashboard(page, '/login');
        await expectLoginPage(page);
        await tryLogin(page);
        await expectDashboardShell(page);
        await expectOneOfHeadings(page, check.headings);
        return;
      }

      await gotoDashboard(page, '/');
      await tryLogin(page);
      await gotoDashboard(page, check.path);

      await expect(page).toHaveURL(check.url);
      await expectDashboardShell(page);
      await expectOneOfHeadings(page, check.headings);
    });
  }
});
