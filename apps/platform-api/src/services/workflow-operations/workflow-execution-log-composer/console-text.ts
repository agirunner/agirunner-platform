import {
  capitalizeSentence,
  readString,
  truncate,
} from './shared.js';

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function readOperatorReadableField(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = readOperatorReadableText(readString(payload[key]), 180);
    if (value) {
      return value;
    }
  }
  return null;
}

export function readOperatorReadableText(value: string | null, maxLength: number): string | null {
  const normalized = normalizeConsoleText(value);
  if (!normalized || looksLikeRawExecutionDump(normalized) || looksLikeLowValueConsoleText(normalized)) {
    return null;
  }
  return truncate(normalizeWorkflowConsoleRecordTerminology(normalized), maxLength);
}

export function normalizeWorkflowConsoleRecordTerminology(value: string): string {
  return value
    .replace(
      /\bWait for the ((?!structured\b)(?!orchestrator\b)[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}) handoff\b/g,
      'Wait for the $1 brief',
    )
    .replace(
      /\bObserved the active ((?!structured\b)(?!orchestrator\b)[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}) handoff\b/g,
      'Observed the active $1 brief',
    )
    .replace(/\bwriting the handoff\b/gi, 'writing the brief')
    .replace(/\bwrite the handoff\b/gi, 'write the brief')
    .replace(/\b[Tt]he handoff is blocked\b/g, (match) => (
      match.startsWith('T') ? 'The brief is blocked' : 'the brief is blocked'
    ));
}

export function normalizeConsoleText(value: string | null): string | null {
  const parsed = readString(value);
  if (!parsed) {
    return null;
  }

  let normalized = parsed
    .replace(/[\u200B-\u200D\u2060\uFEFF\uFFFD]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\bwork_item_id\b/gi, 'work item');

  normalized = sanitizeOperatorIdentifiers(normalized);
  normalized = stripToolCallScaffolding(normalized);
  normalized = stripReportingBoilerplate(normalized);

  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/^\s*(?:approach|plan|plan summary|summary|details)\s*:\s*/i, '')
      .replace(/^\s*(?:operator\s+)?(?:brief|update)\s*:\s*/i, '')
      .replace(/^\s*[•·▪◦●◆▶▷→*-]+\s*/u, '')
      .trim();
  }

  normalized = stripReportingBoilerplate(normalized);
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

export function looksLikeSyntheticActionPreview(
  value: string,
  actionHeadline: string | null,
  actionName: string | null,
): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('calling ')) {
    return true;
  }
  if (normalized === 'tool execution in progress') {
    return true;
  }
  if (actionName && normalized === `${actionName.toLowerCase()}()`) {
    return true;
  }
  if (actionName && normalized.startsWith(`${actionName.toLowerCase()}(`)) {
    return true;
  }
  return actionHeadline ? normalized === actionHeadline.toLowerCase() : false;
}

export function looksLikeLowValueConsoleText(value: string): boolean {
  return (
    /^reactive native-tool turn\.?$/i.test(value)
    || /^advancing the task with the next verified step\.?$/i.test(value)
    || /^working through the next execution step\.?$/i.test(value)
    || /^checking current progress\.?$/i.test(value)
    || /^tool execution in progress\.?$/i.test(value)
    || /^calling\s+[a-z0-9_.-]+(?:\(\))?\.?$/i.test(value)
    || /^burst_budget:/i.test(value)
    || /\brecord the .*?(milestone|terminal|closure|operator-visible).*?\b(brief|update)\b/i.test(value)
    || /\bemit the required .*?\b(brief|update)\b/i.test(value)
    || /\bsubmitt?(?:ing)? the required structured handoff\b/i.test(value)
    || /\bsubmit the structured handoff\b/i.test(value)
    || /\bfinish this (?:heartbeat )?activation\b.*\bstructured handoff\b/i.test(value)
    || /\boperator milestone\b/i.test(value)
    || /\bstill requires (?:its )?structured handoff\b/i.test(value)
    || /\bsatisfy the completion contract\b/i.test(value)
    || /\bterminal structured tool submit_handoff completed the task\b/i.test(value)
    || /\bonly remaining action in this activation is to submit the orchestrator handoff\b/i.test(value)
    || /\bcheckpoint is recorded; the only remaining action in this activation is to submit the orchestrator handoff\b/i.test(value)
    || /\bprogression and next recommended action\b/i.test(value)
    || /\bcorrect next step is to record\b.*\b(?:handoff|brief)\b/i.test(value)
    || /\b(remains|still|continues to be|continues)\b.*\bready\b/i.test(value)
    || /\b(remains|still|continues to be|continues)\b.*\b(suitable|supports|cleared)\b/i.test(value)
  );
}

export function looksLikePlannedActionPlaceholder(value: string): boolean {
  return /^execute\s+[a-z0-9_]+$/i.test(value.trim());
}

export function looksLikeRawExecutionDump(value: string): boolean {
  return (
    value.includes('{')
    || value.includes('}')
    || value.includes('[')
    || value.includes(']')
    || /\brecord_operator_(brief|update)\b/i.test(value)
    || /\boperator (brief|update)s?\b/i.test(value)
    || /^executed\s+\d+\s+tools?/i.test(value)
    || /^signal_mutation:/i.test(value)
    || /^boundary_tool:/i.test(value)
    || /\bphase\s+\w+/i.test(value)
    || /\bturn\s+\d+\b/i.test(value)
    || /\btool steps?\b/i.test(value)
    || /\btool_failure\b/i.test(value)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value)
  );
}

export function normalizeExecutionComparisonText(value: string): string | null {
  return normalizeConsoleText(stripExecutionPhasePrefix(value));
}

export function stripExecutionPhasePrefix(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, '');
}

function sanitizeOperatorIdentifiers(value: string): string {
  return value
    .replace(/\b([a-z-]+)\s+work item\s+[0-9a-f-]{36}\b/gi, '$1 work item')
    .replace(/\b([a-z-]+)\s+task\s+[0-9a-f-]{36}\b/gi, '$1 task')
    .replace(/\bwork item\s+[0-9a-f-]{36}\b/gi, 'the work item')
    .replace(/\bdelivery task\s+[0-9a-f-]{36}\b/gi, 'the delivery task')
    .replace(/\btask\s+[0-9a-f-]{36}\b/gi, 'the task')
    .replace(/\bworkflow\s+[0-9a-f-]{36}\b/gi, 'the workflow')
    .replace(/\bactivation\s+[0-9a-f-]{36}\b/gi, 'this activation')
    .replace(UUID_PATTERN, '')
    .replace(/\bfor work item\b/gi, 'for the work item')
    .replace(/\bon work item\b/gi, 'on the work item')
    .replace(/\bthe the\b/gi, 'the')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripReportingBoilerplate(value: string): string {
  const capturedReportingFact = extractReportingFact(value);
  if (capturedReportingFact) {
    return capturedReportingFact;
  }

  const stripped = value
    .replace(/^I will record that\s*/i, '')
    .replace(
      /\bI will record (?:a|the) (?:required )?(?:milestone |terminal |operator(?:-facing)? |operator-visible )?brief and submit (?:a|the) structured(?: blocked)? handoff summarizing that\s*/i,
      '',
    )
    .replace(
      /^I will record (?:a|the) (?:required )?(?:milestone |terminal |operator(?:-facing)? |operator-visible )?brief and\s*/i,
      '',
    )
    .replace(/\bI will now,\s*summarizing that\s*/i, '')
    .replace(/^Describing that\s*/i, '')
    .replace(/^The activation's required orchestration work is complete:\s*/i, '')
    .replace(/^This activation has completed its required orchestration work:\s*/i, '')
    .replace(
      /\brecord (?:a|the|required )?(?:milestone |terminal |operator(?:-facing)? |operator-visible )?brief(?: now)?(?:,? then)?\s*/i,
      '',
    )
    .replace(/\brecord the reroute milestone now that\s*/i, '')
    .replace(
      /\b(?:close|finish) this (?:heartbeat )?task with (?:a )?blocked handoff:\s*/i,
      '',
    )
    .replace(
      /\bsubmit (?:a|the) structured(?: blocked)? handoff(?: summarizing that)?\s*/i,
      '',
    )
    .replace(
      /\brecord (?:a )?concise milestone plus handoff while\s*/i,
      '',
    )
    .replace(
      /,\s*then close this orchestrator activation(?: with [^.]+)?\.?$/i,
      '',
    )
    .replace(
      /,\s*then close this activation(?: with [^.]+)?\.?$/i,
      '',
    )
    .trim();
  if (stripped !== value && /^[a-z]/.test(stripped)) {
    return stripped.replace(/^[a-z]/, (match) => match.toUpperCase());
  }
  return stripped;
}

function stripToolCallScaffolding(value: string): string {
  if (/^\s*[^:\n]{1,64}:\s*to=[a-z0-9_.:-]+[\s\S]*$/i.test(value)) {
    return '';
  }
  return value
    .replace(/\s*to=[a-z0-9_.:-]+[\s\S]*$/i, '')
    .trim();
}

function extractReportingFact(value: string): string | null {
  const match = value.match(
    /\b(?:record|submit|leave)\b[\s\S]*?\b(?:summarizing that|stating that|captures?)\s+(.+)$/i,
  );
  if (!match?.[1]) {
    return null;
  }
  const rawFact = readString(match[1]) ?? null;
  const fact = rawFact?.replace(/[.]+$/g, '') ?? null;
  if (!fact || /^(?:the )?progression and next recommended action$/i.test(fact)) {
    return null;
  }
  const sentence = capitalizeSentence(fact);
  return rawFact?.endsWith('.') ? `${sentence}.` : sentence;
}
