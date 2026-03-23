export type SafetynetKind = 'safetynet_behavior';
export type SafetynetLayer = 'platform';
export type SafetynetClassification = 'protective' | 'behavior_masking';
export type SafetynetMechanism =
  | 'fallback'
  | 'retry'
  | 'repair'
  | 'inference'
  | 'suppression'
  | 'completion_assist'
  | 'redaction';
export type SafetynetDefaultPolicy = 'enabled';
export type SafetynetDisposition = 'keep';
export type SafetynetStatus = 'active' | 'candidate_for_tightening';

export interface SafetynetEntry {
  kind: SafetynetKind;
  id: string;
  layer: SafetynetLayer;
  name: string;
  classification: SafetynetClassification;
  mechanism: SafetynetMechanism;
  default_policy: SafetynetDefaultPolicy;
  disposition: SafetynetDisposition;
  trigger: string;
  nominal_contract: string;
  intervention: string;
  risk_if_triggered: string;
  operator_visibility: string;
  owner_module: string;
  test_requirements: string[];
  metrics_key: string;
  log_event_type: string;
  review_notes: string;
  status: SafetynetStatus;
}
