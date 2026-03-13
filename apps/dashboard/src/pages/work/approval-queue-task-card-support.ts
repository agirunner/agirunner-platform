import type { DashboardApprovalTaskRecord } from '../../lib/api.js';

export interface ApprovalTaskPacket {
  title: string;
  summary: string;
}

export function buildApprovalDecisionPacket(
  task: DashboardApprovalTaskRecord,
): ApprovalTaskPacket {
  if (task.state === 'output_pending_review') {
    return {
      title: 'Review the output packet',
      summary:
        'Validate the specialist output, then either approve it, request targeted changes, or reject it if the work should not continue.',
    };
  }

  return {
    title: 'Approve or reject the specialist step',
    summary:
      'Review the board context and current step evidence before deciding whether this specialist step should advance, be reworked, or stop here.',
  };
}

export function buildApprovalRecoveryPacket(task: DashboardApprovalTaskRecord): ApprovalTaskPacket {
  if (task.work_item_id) {
    return {
      title: 'Keep recovery in the work-item flow',
      summary:
        'Run rework, retry, and follow-up decisions from the linked work-item flow so board state, related steps, and operator context stay aligned.',
    };
  }

  if (task.workflow_id) {
    return {
      title: 'Keep recovery in the board stage flow',
      summary:
        'Run rework and follow-up decisions from the board stage flow so the stage gate and linked work stay attached to the workflow context.',
    };
  }

  if (typeof task.rework_count === 'number' && task.rework_count > 0) {
    return {
      title: 'Give the next rework round precise direction',
      summary:
        'This step has already been reworked. If you request another round, make the feedback specific enough that the next specialist pass can close the gap.',
    };
  }

  return {
    title: 'Use direct operator review',
    summary:
      'This step has no higher-level board context. Use approval, request changes, or rejection directly on the step record and keep feedback concrete.',
  };
}

export function buildApprovalOutputPacket(
  task: DashboardApprovalTaskRecord,
): ApprovalTaskPacket {
  const preview = truncateOutput(task.output);
  if (!preview) {
    return {
      title: 'No output preview recorded yet',
      summary:
        'Open the step record and logs before approving. If the specialist should have produced evidence by now, request changes or reject with context.',
    };
  }

  return {
    title: 'Output evidence is available',
    summary:
      'Start with the short preview below, then open the full step record if you need exact payload details or linked artifacts before deciding.',
  };
}

export function truncateOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  if (text.length <= 200) return text;
  return `${text.slice(0, 200)}...`;
}
