export type AuthenticityRoute = 'deterministic' | 'hybrid-llm';

export interface ScenarioAuthenticityRoutingEntry {
  scenario: string;
  route: AuthenticityRoute;
  rationale: string;
}

export const SCENARIO_AUTHENTICITY_ROUTING: ScenarioAuthenticityRoutingEntry[] = [
  {
    scenario: 'sdlc-happy',
    route: 'hybrid-llm',
    rationale:
      'Autonomous SDLC delivery output is non-deterministic and requires semantic authenticity audit.',
  },
  {
    scenario: 'ap2-external-runtime',
    route: 'deterministic',
    rationale: 'Harness-driven external runtime scenario with deterministic structural assertions.',
  },
  {
    scenario: 'ap3-standalone-worker',
    route: 'deterministic',
    rationale: 'Standalone worker integration path validated via deterministic state transitions.',
  },
  {
    scenario: 'ap4-mixed-workers',
    route: 'deterministic',
    rationale:
      'Worker-routing coverage is deterministic and does not depend on semantic LLM output quality.',
  },
  {
    scenario: 'sdlc-sad',
    route: 'hybrid-llm',
    rationale:
      'Failure/recovery path still carries non-deterministic task output content requiring LLM authenticity audit.',
  },
  {
    scenario: 'maintenance-happy',
    route: 'hybrid-llm',
    rationale:
      'Bug triage/fix/verify narrative quality is non-deterministic and needs LLM authenticity checks.',
  },
  {
    scenario: 'maintenance-sad',
    route: 'deterministic',
    rationale: 'Cancellation path uses deterministic task-state assertions only.',
  },
  {
    scenario: 'ap5-full',
    route: 'hybrid-llm',
    rationale:
      'Multi-bug autonomous maintenance output is non-deterministic and requires LLM authenticity validation.',
  },
  {
    scenario: 'ap6-runtime-maintenance',
    route: 'deterministic',
    rationale:
      'External runtime maintenance orchestration checks are deterministic in harness mode.',
  },
  {
    scenario: 'ap7-failure-recovery',
    route: 'hybrid-llm',
    rationale:
      'Failure/retry delivery artifacts include non-deterministic language outputs requiring LLM authenticity review.',
  },
  {
    scenario: 'ot1-cascade',
    route: 'deterministic',
    rationale: 'Dependency cascade logic is deterministic control-plane behavior.',
  },
  {
    scenario: 'ot2-routing',
    route: 'deterministic',
    rationale: 'Capability routing is deterministic and asserted by state transitions.',
  },
  {
    scenario: 'ot3-state',
    route: 'deterministic',
    rationale: 'Pipeline state derivation is deterministic by design.',
  },
  {
    scenario: 'ot4-health',
    route: 'deterministic',
    rationale: 'Worker health/recovery behavior is deterministic platform logic.',
  },
  {
    scenario: 'hl1-approval-flow',
    route: 'deterministic',
    rationale: 'Approval and retry controls are deterministic API/UI transitions.',
  },
  {
    scenario: 'hl2-pipeline-controls',
    route: 'deterministic',
    rationale: 'Control-plane task/pipeline operations are deterministic.',
  },
  {
    scenario: 'it1-sdk',
    route: 'deterministic',
    rationale: 'SDK lifecycle assertions are deterministic protocol checks.',
  },
  {
    scenario: 'it2-mcp',
    route: 'deterministic',
    rationale: 'MCP transport/protocol checks are deterministic.',
  },
  {
    scenario: 'it3-webhooks',
    route: 'deterministic',
    rationale: 'Webhook signature/encryption behavior is deterministic.',
  },
  {
    scenario: 'it3-mcp-sse-stream',
    route: 'deterministic',
    rationale: 'SSE stream correctness checks are deterministic.',
  },
  {
    scenario: 'si1-isolation',
    route: 'deterministic',
    rationale: 'Isolation checks are deterministic authorization/data-scope assertions.',
  },
  {
    scenario: 'si2-auth',
    route: 'deterministic',
    rationale: 'Auth rejection/bootstrap checks are deterministic.',
  },
  {
    scenario: 'si2-extended-isolation',
    route: 'deterministic',
    rationale: 'Extended isolation checks are deterministic and state-based.',
  },
];

const ROUTE_BY_SCENARIO = new Map(
  SCENARIO_AUTHENTICITY_ROUTING.map((entry) => [entry.scenario, entry.route] as const),
);

export function resolveScenarioAuthenticityRoute(scenario: string): AuthenticityRoute {
  return ROUTE_BY_SCENARIO.get(scenario) ?? 'deterministic';
}

export function listScenariosByAuthenticityRoute(route: AuthenticityRoute): string[] {
  return SCENARIO_AUTHENTICITY_ROUTING.filter((entry) => entry.route === route).map(
    (entry) => entry.scenario,
  );
}
