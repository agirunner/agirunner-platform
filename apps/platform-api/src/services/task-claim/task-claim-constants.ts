export const priorityCase = "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";

export const claimRoleConfigSecretKeys = new Set([
  'llm_api_key',
  'llm_api_key_secret_ref',
  'llm_extra_headers',
  'llm_extra_headers_secret_ref',
  'api_key',
  'access_token',
  'token',
  'authorization',
]);

export const CLAIM_CREDENTIAL_HANDLE_VERSION = 'v1';
export const CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM = 'aes-256-gcm';
export const CLAIM_CREDENTIAL_HANDLE_IV_LENGTH_BYTES = 12;
export const DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS = 32_000;

export const gitTokenCredentialKeys = [
  'token',
  'git_token',
  'access_token',
  'token_ref',
  'git_token_ref',
  'access_token_ref',
  'secret_ref',
];

export const gitSSHPrivateKeyCredentialKeys = [
  'git_ssh_private_key',
  'ssh_private_key',
  'private_key',
  'git_ssh_private_key_ref',
  'ssh_private_key_ref',
  'private_key_ref',
];

export const gitSSHKnownHostsCredentialKeys = [
  'git_ssh_known_hosts',
  'ssh_known_hosts',
  'known_hosts',
  'git_ssh_known_hosts_ref',
  'ssh_known_hosts_ref',
  'known_hosts_ref',
];

export const specialistOperatorRecordToolIds = ['record_operator_brief'] as const;
