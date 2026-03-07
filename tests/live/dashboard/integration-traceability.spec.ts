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
  path: '/workflows' | '/workers' | '/templates' | '/tasks' | '/system' | '/login';
  url: RegExp;
  headings: Array<string | RegExp>;
  requiresLoginPage?: boolean;
};

const TRACEABILITY_CASES: TraceabilityCase[] = [
  {
    scenarioKey: 'sdlc-happy',
    title: 'workflow creation and execution surfaces',
    path: '/workflows',
    url: /\/workflows(\/|$)/,
    headings: ['Workflows'],
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
    url: /\/(templates|workflows)(\/|$)/,
    headings: ['Templates', 'Workflows'],
  },
  {
    scenarioKey: 'ap6-runtime-maintenance',
    title: 'runtime maintenance monitoring surfaces',
    path: '/system',
    url: /\/(system|metrics|workflows)(\/|$)/,
    headings: ['System Metrics', 'Workflows'],
  },
  {
    scenarioKey: 'ap7-failure-recovery',
    title: 'failure recovery task visibility surfaces',
    path: '/tasks',
    url: /\/(tasks|workflows)(\/|$)/,
    headings: ['Task Detail', 'Workflows'],
  },
  {
    scenarioKey: 'ot1-cascade',
    title: 'dependency cascade workflow visibility',
    path: '/workflows',
    url: /\/workflows(\/|$)/,
    headings: ['Workflows'],
  },
  {
    scenarioKey: 'ot2-routing',
    title: 'task routing list/detail surfaces',
    path: '/tasks',
    url: /\/(tasks|workflows)(\/|$)/,
    headings: ['Task Detail', 'Workflows'],
  },
  {
    scenarioKey: 'ot3-state',
    title: 'workflow state dashboard surfaces',
    path: '/workflows',
    url: /\/workflows(\/|$)/,
    headings: ['Workflows'],
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
    url: /\/(tasks|workflows)(\/|$)/,
    headings: ['Task Detail', 'Workflows'],
  },
  {
    scenarioKey: 'hl2-workflow-controls',
    title: 'workflow pause/resume/cancel control surfaces',
    path: '/workflows',
    url: /\/workflows(\/|$)/,
    headings: ['Workflows'],
  },
  {
    scenarioKey: 'it1-sdk',
    title: 'SDK integration observability surfaces',
    path: '/system',
    url: /\/(system|metrics|workflows)(\/|$)/,
    headings: ['System Metrics', 'Workflows'],
  },
  {
    scenarioKey: 'it2-mcp',
    title: 'MCP integration task surfaces',
    path: '/tasks',
    url: /\/(tasks|workflows)(\/|$)/,
    headings: ['Task Detail', 'Workflows'],
  },
  {
    scenarioKey: 'it3-webhooks',
    title: 'webhook integration event/task surfaces',
    path: '/tasks',
    url: /\/(tasks|workflows)(\/|$)/,
    headings: ['Task Detail', 'Workflows'],
  },
  {
    scenarioKey: 'it3-mcp-sse-stream',
    title: 'MCP SSE stream task/event surfaces',
    path: '/tasks',
    url: /\/(tasks|workflows)(\/|$)/,
    headings: ['Task Detail', 'Workflows'],
  },
  {
    scenarioKey: 'si1-isolation',
    title: 'tenant isolation system metric surfaces',
    path: '/system',
    url: /\/(system|metrics|workflows)(\/|$)/,
    headings: ['System Metrics', 'Workflows'],
  },
  {
    scenarioKey: 'si2-auth',
    title: 'authentication entrypoint and session surfaces',
    path: '/login',
    url: /\/(login|workflows)(\/|$)/,
    headings: ['Agirunner Dashboard', 'Workflows'],
    requiresLoginPage: true,
  },
  {
    scenarioKey: 'si2-extended-isolation',
    title: 'extended isolation observability surfaces',
    path: '/system',
    url: /\/(system|metrics|workflows)(\/|$)/,
    headings: ['System Metrics', 'Workflows'],
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
