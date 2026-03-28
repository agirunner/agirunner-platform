const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WORKFLOW_CONSOLE_ENTRY_STYLES = {
  brief: {
    entryClassName: 'border-l-emerald-400/70 bg-emerald-500/5',
    promptClassName: 'text-emerald-300',
    sourceClassName: 'text-emerald-100',
  },
  notice: {
    entryClassName: 'border-l-amber-400/70 bg-amber-500/5',
    promptClassName: 'text-amber-300',
    sourceClassName: 'text-amber-100',
  },
  update: {
    entryClassName: 'border-l-slate-700 bg-slate-950/70',
    promptClassName: 'text-cyan-300',
    sourceClassName: 'text-slate-100',
  },
} as const;

export function formatWorkflowActivitySourceLabel(sourceLabel: string, sourceKind: string): string {
  const normalizedLabel = readNonEmptyText(sourceLabel);
  if (normalizedLabel && !UUID_RE.test(normalizedLabel)) {
    return humanizeToken(normalizedLabel);
  }

  return humanizeToken(sourceKind);
}

export function normalizeWorkflowConsoleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function getWorkflowConsoleEntryStyle(itemKind: string): {
  dataKind: 'brief' | 'notice' | 'update';
  entryClassName: string;
  promptClassName: string;
  sourceClassName: string;
} {
  if (itemKind === 'milestone_brief') {
    return {
      dataKind: 'brief',
      ...WORKFLOW_CONSOLE_ENTRY_STYLES.brief,
    };
  }

  if (itemKind === 'platform_notice') {
    return {
      dataKind: 'notice',
      ...WORKFLOW_CONSOLE_ENTRY_STYLES.notice,
    };
  }

  return {
    dataKind: 'update',
    ...WORKFLOW_CONSOLE_ENTRY_STYLES.update,
  };
}

function readNonEmptyText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
