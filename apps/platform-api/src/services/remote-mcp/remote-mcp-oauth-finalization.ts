import type {
  CreateVerifiedRemoteMcpServerInput,
  UpdateVerifiedRemoteMcpServerInput,
} from '../remote-mcp-server-service.js';
import type { RemoteMcpOAuthConfigRecord } from '../remote-mcp-model.js';
import type { TokenResponse } from '../remote-mcp-oauth-types.js';
import type { RemoteMcpVerifier } from '../remote-mcp-verification-service.js';
import {
  buildStoredOauthCredentials,
  parseDraftOauthDefinition,
  parseDraftParameters,
  persistableOauthConfig,
} from './remote-mcp-oauth-helpers.js';
import type { DraftRow } from './remote-mcp-oauth-store.js';

type VerificationResult = Awaited<ReturnType<RemoteMcpVerifier['verify']>>;

interface PersistAuthorizedServerInput {
  tenantId: string;
  userId: string;
  draft: DraftRow;
  oauthConfig: RemoteMcpOAuthConfigRecord;
  token: TokenResponse;
  discoveryStrategy: string;
  oauthStrategy: string;
  verification: VerificationResult;
}

export async function verifyConnectedServer(
  verifier: RemoteMcpVerifier,
  draft: DraftRow,
  accessToken: string,
): Promise<VerificationResult> {
  const parameters = parseDraftParameters(draft.parameters);
  return verifier.verify({
    endpointUrl: draft.endpoint_url,
    transportPreference: draft.transport_preference ?? 'auto',
    callTimeoutSeconds: draft.call_timeout_seconds,
    authMode: 'oauth',
    parameters: [
      ...parameters,
      {
        placement: 'header',
        key: 'Authorization',
        valueKind: 'secret',
        value: `Bearer ${accessToken}`,
      },
    ],
  });
}

export function buildCreateVerifiedServerInput(
  input: PersistAuthorizedServerInput,
): CreateVerifiedRemoteMcpServerInput {
  return {
    name: input.draft.name,
    description: input.draft.description,
    endpointUrl: input.draft.endpoint_url,
    transportPreference: input.draft.transport_preference ?? 'auto',
    callTimeoutSeconds: input.draft.call_timeout_seconds,
    authMode: 'oauth',
    enabledByDefaultForNewSpecialists: input.draft.enabled_by_default_for_new_specialists,
    grantToAllExistingSpecialists: input.draft.grant_to_all_existing_specialists,
    oauthClientProfileId: input.draft.oauth_client_profile_id,
    oauthDefinition: parseDraftOauthDefinition(input.draft.oauth_definition),
    verificationStatus: input.verification.verification_status,
    verificationError: input.verification.verification_error,
    verifiedTransport: input.verification.verified_transport,
    verifiedDiscoveryStrategy: input.discoveryStrategy,
    verifiedOAuthStrategy: input.oauthStrategy,
    verificationContractVersion: input.verification.verification_contract_version,
    verifiedCapabilitySummary: input.verification.verified_capability_summary,
    discoveredToolsSnapshot: input.verification.discovered_tools_snapshot,
    discoveredResourcesSnapshot: input.verification.discovered_resources_snapshot,
    discoveredPromptsSnapshot: input.verification.discovered_prompts_snapshot,
    parameters: parseDraftParameters(input.draft.parameters),
    oauthConfig: persistableOauthConfig(input.oauthConfig),
    oauthCredentials: buildStoredOauthCredentials(input.token, input.userId),
  };
}

export function buildUpdateVerifiedServerInput(
  input: PersistAuthorizedServerInput,
): UpdateVerifiedRemoteMcpServerInput {
  return {
    callTimeoutSeconds: input.draft.call_timeout_seconds,
    transportPreference: input.draft.transport_preference ?? 'auto',
    verificationStatus: input.verification.verification_status,
    verificationError: input.verification.verification_error,
    verifiedTransport: input.verification.verified_transport,
    verifiedDiscoveryStrategy: input.discoveryStrategy,
    verifiedOAuthStrategy: input.oauthStrategy,
    verificationContractVersion: input.verification.verification_contract_version,
    verifiedCapabilitySummary: input.verification.verified_capability_summary,
    discoveredToolsSnapshot: input.verification.discovered_tools_snapshot,
    discoveredResourcesSnapshot: input.verification.discovered_resources_snapshot,
    discoveredPromptsSnapshot: input.verification.discovered_prompts_snapshot,
    oauthClientProfileId: input.draft.oauth_client_profile_id,
    oauthDefinition: parseDraftOauthDefinition(input.draft.oauth_definition),
    oauthConfig: persistableOauthConfig(input.oauthConfig),
    oauthCredentials: buildStoredOauthCredentials(input.token, input.userId),
  };
}
