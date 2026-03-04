export type Provider = 'openai' | 'google' | 'anthropic' | 'none';
export type TestLane = 'core' | 'live';
export type TemplateType = 'sdlc' | 'maintenance' | 'dashboard';

export interface RunnerOptions {
  all: boolean;
  lane: TestLane;
  template?: TemplateType;
  provider?: Provider;
  happyOnly: boolean;
  sadOnly: boolean;
  repeat: number;
  dashboard: boolean;
  keepStack: boolean;
  preflightOnly: boolean;
  fastReset: boolean;
}

export interface ScenarioResult {
  status: 'pass' | 'fail';
  duration: string;
  cost: string;
  artifacts: number;
  validations: number;
  screenshots: string[];
  error?: string;
}

export interface RunTiming {
  setupMs: number;
  scenarioMs: Record<string, number>;
  teardownMs: number;
  totalMs: number;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  template: TemplateType;
  provider: Provider;
  repeat: number;
  scenarios: Record<string, ScenarioResult>;
  integrationEvidenceSource?: string;
  containers_leaked: number;
  temp_files_leaked: number;
  total_cost: string;
  timing?: RunTiming;
}

export interface LiveContext {
  runId: string;
  provider: Provider;
  template: TemplateType;
  reportDir: string;
  screenshotDir: string;
  env: {
    apiBaseUrl: string;
    dashboardBaseUrl: string;
    postgresUrl: string;
  };
  keys: {
    admin: string;
    worker: string;
    agent: string;
  };
  ids: {
    workerId: string;
    agentId: string;
  };
}

export interface ScenarioDeliveryEvidenceTask {
  id: string;
  role?: string;
  state: string;
  output?: Record<string, unknown> | null;
}

export interface ScenarioDeliveryEvidence {
  pipelineId: string;
  pipelineState: string;
  tasks: ScenarioDeliveryEvidenceTask[];
  acceptanceCriteria: string[];
  requiresGitDiffEvidence?: boolean;
  requiredArtifacts?: string[];
}

export interface ScenarioExecutionResult {
  name: string;
  costUsd: number;
  artifacts: string[];
  validations: string[];
  screenshots: string[];
  authenticityEvidence?: ScenarioDeliveryEvidence[];
}

export interface PipelineSnapshot {
  id: string;
  state: string;
  tasks: Array<{ id: string; state: string; role?: string }>;
}

export interface ScenarioContext {
  live: LiveContext;
  happyOnly: boolean;
  sadOnly: boolean;
}
