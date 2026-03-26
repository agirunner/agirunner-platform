import {
  EXECUTION_ENVIRONMENT_CONTRACT_VERSION,
  type ExecutionEnvironmentCatalogRecord,
} from './execution-environment-contract.js';

export const BASELINE_EXECUTION_ENVIRONMENT_COMMANDS = [
  'sleep',
  'sh',
  'cat',
  'mkdir',
  'mv',
  'chmod',
  'rm',
  'cp',
  'find',
  'sort',
  'awk',
  'sed',
  'grep',
  'head',
] as const;

export function buildCatalogSeedVerification(
  catalog: Pick<ExecutionEnvironmentCatalogRecord, 'declared_metadata' | 'image'>,
): {
  compatibility_status: 'compatible';
  compatibility_errors: string[];
  verification_contract_version: string;
  verified_metadata: Record<string, unknown>;
  tool_capabilities: Record<string, unknown>;
  is_claimable: true;
} {
  return {
    compatibility_status: 'compatible',
    compatibility_errors: [],
    verification_contract_version: EXECUTION_ENVIRONMENT_CONTRACT_VERSION,
    verified_metadata: {
      ...catalog.declared_metadata,
      image_ref: catalog.image,
      probe_source: 'catalog_seed',
    },
    tool_capabilities: {
      verified_baseline_commands: [...BASELINE_EXECUTION_ENVIRONMENT_COMMANDS],
      shell_glob: true,
      shell_pipe: true,
      shell_redirect: true,
      command_probe_source: 'catalog_seed',
    },
    is_claimable: true,
  };
}
