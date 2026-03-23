export function buildMovementSummary(
  data: Record<string, unknown> | undefined,
  stageName: string | null,
): string | null {
  const columnLabel =
    readString(data?.column_label) ??
    readString(data?.to_column_label) ??
    readString(data?.column_id) ??
    readString(data?.to_column_id);
  if (columnLabel && stageName) return `Moved to ${columnLabel} in ${stageName}.`;
  if (columnLabel) return `Moved to ${columnLabel}.`;
  if (stageName) return `Moved within ${stageName}.`;
  return null;
}

export function buildBudgetSummary(
  data: Record<string, unknown> | undefined,
  severity: 'warning' | 'exceeded',
): string {
  const dimensions = readStringArray(data?.dimensions);
  const segments: string[] = [];
  if (dimensions.includes('tokens')) {
    segments.push(buildBudgetSegment('tokens', readNumber(data?.tokens_used), readNumber(data?.tokens_limit), formatInteger));
  }
  if (dimensions.includes('cost')) {
    segments.push(buildBudgetSegment('cost', readNumber(data?.cost_usd), readNumber(data?.cost_limit_usd), formatCurrency));
  }
  if (dimensions.includes('duration')) {
    segments.push(buildBudgetSegment('duration', readNumber(data?.elapsed_minutes), readNumber(data?.duration_limit_minutes), formatMinutes));
  }
  if (segments.length === 0) {
    return severity === 'warning'
      ? 'Workflow activity is approaching a configured budget boundary.'
      : 'Workflow activity crossed a configured budget boundary.';
  }
  const prefix =
    severity === 'warning'
      ? 'Approaching configured workflow guardrails for '
      : 'Configured workflow guardrails were exceeded for ';
  return `${prefix}${segments.join('; ')}.`;
}

export function describeTimelineEmphasisLabel(eventType: string): string {
  if (eventType.startsWith('stage.gate.')) return 'Gate decision';
  if (eventType === 'stage.gate_requested') return 'Gate review';
  if (eventType.startsWith('stage.')) return 'Stage progress';
  if (eventType.startsWith('task.')) {
    if (eventType.includes('escalat')) return 'Escalation';
    if (eventType.includes('failed')) return 'Failure';
    return 'Specialist step';
  }
  if (eventType.startsWith('work_item.')) return 'Board work';
  if (eventType.startsWith('workflow.activation_')) return 'Orchestrator';
  if (eventType.startsWith('workflow.')) return 'Board status';
  if (eventType.startsWith('budget.')) return 'Budget';
  if (eventType.startsWith('child_workflow.')) return 'Child board';
  return 'Activity';
}

export function describeTimelineEmphasisTone(
  eventType: string,
): 'secondary' | 'warning' | 'destructive' | 'success' {
  if (eventType.includes('escalat') || eventType.includes('gate.reject') || eventType.includes('failed') || eventType === 'budget.exceeded') {
    return 'destructive';
  }
  if (eventType.includes('request_changes') || eventType.includes('gate_requested') || eventType === 'budget.warning') {
    return 'warning';
  }
  if (eventType.includes('completed') || eventType.includes('approve')) {
    return 'success';
  }
  return 'secondary';
}

export function readNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

export function humanizeToken(value: string): string {
  return value.replaceAll('.', ' ').replaceAll('_', ' ');
}

export function capitalizeToken(value: string): string {
  const humanized = humanizeToken(value);
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildBudgetSegment(
  label: string,
  used: number | null,
  limit: number | null,
  formatter: (value: number) => string,
): string {
  const formattedUsed = used === null ? 'unknown usage' : formatter(used);
  const formattedLimit = limit === null ? 'no cap' : formatter(limit);
  return `${label} (${formattedUsed} / ${formattedLimit})`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatMinutes(value: number): string {
  return `${value.toFixed(2)} min`;
}
