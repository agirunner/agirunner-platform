export const PENDING_STAGE_GATE_EVENT_TYPES = [
  'stage.gate_requested',
  'stage.gate.approve',
  'stage.gate.reject',
  'stage.gate.request_changes',
] as const;

export const STAGE_GATE_EVENT_TYPES = [
  'stage.gate_requested',
  'stage.gate.approve',
  'stage.gate.block',
  'stage.gate.reject',
  'stage.gate.request_changes',
] as const;
