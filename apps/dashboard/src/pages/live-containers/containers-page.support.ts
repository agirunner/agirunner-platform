import type { DashboardLiveContainerRecord } from '../../lib/api.js';
import {
  normalizeText,
} from './containers-page.diff.js';
import type { SessionContainerRow } from './containers-session-rows.js';

export type { ContainerDiffField } from './containers-page.diff.js';
export {
  advanceSessionContainerRows,
  hasPendingField,
  hasRecentlyChangedField,
  isPendingChangeRow,
  isRecentlyChangedRow,
  mergeLiveContainerSessionRows,
  type SessionContainerRow,
} from './containers-session-rows.js';

export function formatContainerKindLabel(kind: DashboardLiveContainerRecord['kind']): string {
  switch (kind) {
    case 'orchestrator':
      return 'Orchestrator agent';
    case 'runtime':
      return 'Specialist Agent';
    case 'task':
      return 'Specialist Execution';
    default:
      return kind;
  }
}

export function partitionSessionContainerRowsByFunction(rows: SessionContainerRow[]): {
  orchestrator: SessionContainerRow[];
  specialists: SessionContainerRow[];
} {
  return rows.reduce(
    (groups, row) => {
      if (isOrchestratorFunctionRow(row)) {
        groups.orchestrator.push(row);
      } else {
        groups.specialists.push(row);
      }
      return groups;
    },
    { orchestrator: [] as SessionContainerRow[], specialists: [] as SessionContainerRow[] },
  );
}

function isOrchestratorFunctionRow(row: SessionContainerRow): boolean {
  return (
    row.kind === 'orchestrator' || normalizeText(row.role_name).toLowerCase() === 'orchestrator'
  );
}
