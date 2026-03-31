import { ValidationError } from '../../../errors/domain-errors.js';
import {
  hasRemoteMcpCapabilities,
  type RemoteMcpCapabilitySummary,
} from '../core/remote-mcp-capability-snapshot.js';
import type {
  RemoteMcpOAuthConfigRecord,
  RemoteMcpOAuthCredentialsRecord,
  RemoteMcpParameterInput,
  RemoteMcpTransportPreference,
} from '../core/remote-mcp-model.js';
import type {
  CreateVerifiedRemoteMcpServerInput,
  RemoteMcpServerService,
  StoredRemoteMcpServerRecord,
  UpdateVerifiedRemoteMcpServerInput,
} from '../servers/remote-mcp-server-service.js';

export interface RemoteMcpVerifier {
  verify(input: {
    endpointUrl: string;
    callTimeoutSeconds: number;
    transportPreference: RemoteMcpTransportPreference;
    authMode: 'none' | 'parameterized' | 'oauth';
    parameters: RemoteMcpParameterInput[];
  }): Promise<{
    verification_status: 'unknown' | 'verified' | 'failed';
    verification_error: string | null;
    verified_transport: 'streamable_http' | 'http_sse_compat' | null;
    verification_contract_version: string;
    discovered_tools_snapshot: Array<Record<string, unknown>>;
    discovered_resources_snapshot: Array<Record<string, unknown>>;
    discovered_prompts_snapshot: Array<Record<string, unknown>>;
    verified_capability_summary: RemoteMcpCapabilitySummary;
    verified_discovery_strategy: string | null;
    verified_oauth_strategy: string | null;
  }>;
}

type VerificationManagedFields =
  | 'verificationStatus'
  | 'verificationError'
  | 'verifiedTransport'
  | 'verifiedDiscoveryStrategy'
  | 'verifiedOAuthStrategy'
  | 'verificationContractVersion'
  | 'verifiedCapabilitySummary'
  | 'discoveredToolsSnapshot'
  | 'discoveredResourcesSnapshot'
  | 'discoveredPromptsSnapshot';

type CreateRemoteMcpVerificationInput = Omit<CreateVerifiedRemoteMcpServerInput, VerificationManagedFields>;
type UpdateRemoteMcpVerificationInput = Omit<UpdateVerifiedRemoteMcpServerInput, VerificationManagedFields>;

export class RemoteMcpVerificationService {
  constructor(
    private readonly serverService: Pick<
      RemoteMcpServerService,
      | 'createVerifiedServer'
      | 'updateVerifiedServer'
      | 'updateVerificationResult'
      | 'getStoredServer'
      | 'updateMetadataOnly'
    >,
    private readonly verifier: RemoteMcpVerifier,
    private readonly oauthAuthorizationResolver?: {
      resolveVerificationAuthorizationValue(server: {
        id: string;
        oauthConfig: RemoteMcpOAuthConfigRecord | null;
        oauthCredentials: RemoteMcpOAuthCredentialsRecord | null;
      }): Promise<string>;
    },
  ) {}

  async createServer(
    tenantId: string,
    input: CreateRemoteMcpVerificationInput,
  ) {
    const verification = await this.verifyOrThrow(
      input.endpointUrl,
      input.callTimeoutSeconds ?? 300,
      input.transportPreference ?? 'auto',
      input.authMode,
      input.parameters ?? [],
    );
    return this.serverService.createVerifiedServer(tenantId, {
      ...input,
      verificationStatus: verification.verification_status,
      verificationError: verification.verification_error,
      verifiedTransport: verification.verified_transport,
      verificationContractVersion: verification.verification_contract_version,
      discoveredToolsSnapshot: verification.discovered_tools_snapshot,
      discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
      discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
      verifiedCapabilitySummary: verification.verified_capability_summary,
      verifiedDiscoveryStrategy: verification.verified_discovery_strategy,
      verifiedOAuthStrategy: verification.verified_oauth_strategy,
    });
  }

  async updateServer(
    tenantId: string,
    id: string,
    input: UpdateRemoteMcpVerificationInput,
  ) {
    const current = await this.serverService.getStoredServer(tenantId, id);
    const connectivityChanged =
      (input.endpointUrl !== undefined && input.endpointUrl !== current.endpoint_url)
      || (input.transportPreference !== undefined && input.transportPreference !== current.transport_preference)
      || (input.callTimeoutSeconds !== undefined && input.callTimeoutSeconds !== current.call_timeout_seconds)
      || (input.authMode !== undefined && input.authMode !== current.auth_mode)
      || (input.oauthDefinition !== undefined)
      || input.parameters !== undefined;
    if (!connectivityChanged) {
      return this.serverService.updateMetadataOnly(tenantId, id, {
        description: input.description,
        enabledByDefaultForNewSpecialists: input.enabledByDefaultForNewSpecialists,
      });
    }
    const parameters = await this.buildVerificationParameters(
      current,
      input.authMode ?? current.auth_mode,
      input.parameters ?? current.parameters.map((parameter) => ({
        placement: parameter.placement,
        key: parameter.key,
        valueKind: parameter.value_kind,
        value: parameter.value,
      })),
    );
    const verification = await this.verifyOrThrow(
      input.endpointUrl ?? current.endpoint_url,
      input.callTimeoutSeconds ?? current.call_timeout_seconds,
      input.transportPreference ?? current.transport_preference,
      input.authMode ?? current.auth_mode,
      parameters,
    );
    return this.serverService.updateVerifiedServer(tenantId, id, {
      ...input,
      verificationStatus: verification.verification_status,
      verificationError: verification.verification_error,
      verifiedTransport: verification.verified_transport,
      verificationContractVersion: verification.verification_contract_version,
      discoveredToolsSnapshot: verification.discovered_tools_snapshot,
      discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
      discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
      verifiedCapabilitySummary: verification.verified_capability_summary,
      verifiedDiscoveryStrategy: verification.verified_discovery_strategy,
      verifiedOAuthStrategy: verification.verified_oauth_strategy,
    });
  }

  async reverifyServer(tenantId: string, id: string) {
    const current = await this.serverService.getStoredServer(tenantId, id);
    const parameters = await this.buildVerificationParameters(
      current,
      current.auth_mode,
      current.parameters.map((parameter) => ({
        placement: parameter.placement,
        key: parameter.key,
        valueKind: parameter.value_kind,
        value: parameter.value,
      })),
    );
    const verification = await this.verifyOrThrow(
      current.endpoint_url,
      current.call_timeout_seconds,
      current.transport_preference,
      current.auth_mode,
      parameters,
    );
    return this.serverService.updateVerificationResult(tenantId, id, {
      verificationStatus: verification.verification_status,
      verificationError: verification.verification_error,
      verifiedTransport: verification.verified_transport,
      verificationContractVersion: verification.verification_contract_version,
      discoveredToolsSnapshot: verification.discovered_tools_snapshot,
      discoveredResourcesSnapshot: verification.discovered_resources_snapshot,
      discoveredPromptsSnapshot: verification.discovered_prompts_snapshot,
      verifiedCapabilitySummary: verification.verified_capability_summary,
      verifiedDiscoveryStrategy: verification.verified_discovery_strategy,
      verifiedOAuthStrategy: verification.verified_oauth_strategy,
    });
  }

  private async verifyOrThrow(
    endpointUrl: string,
    callTimeoutSeconds: number,
    transportPreference: RemoteMcpTransportPreference,
    authMode: 'none' | 'parameterized' | 'oauth',
    parameters: RemoteMcpParameterInput[],
  ) {
    const verification = await this.verifier.verify({
      endpointUrl,
      callTimeoutSeconds,
      transportPreference,
      authMode,
      parameters,
    });
    if (!hasRemoteMcpCapabilities(
      Array.isArray(verification.discovered_tools_snapshot) ? verification.discovered_tools_snapshot : [],
      Array.isArray(verification.discovered_resources_snapshot) ? verification.discovered_resources_snapshot : [],
      Array.isArray(verification.discovered_prompts_snapshot) ? verification.discovered_prompts_snapshot : [],
    )) {
      throw new ValidationError('Remote MCP verification discovered zero tools, resources, and prompts');
    }
    return verification;
  }

  private async buildVerificationParameters(
    current: Pick<StoredRemoteMcpServerRecord, 'id' | 'oauth_config' | 'oauth_credentials'>,
    authMode: 'none' | 'parameterized' | 'oauth',
    parameters: RemoteMcpParameterInput[],
  ) {
    if (authMode !== 'oauth') {
      return parameters;
    }
    if (!this.oauthAuthorizationResolver) {
      throw new ValidationError('Remote MCP OAuth verification support is not configured');
    }
    const authorizationValue = await this.oauthAuthorizationResolver.resolveVerificationAuthorizationValue({
      id: current.id,
      oauthConfig: current.oauth_config,
      oauthCredentials: current.oauth_credentials,
    });
    return [
      ...parameters,
      {
        placement: 'header' as const,
        key: 'Authorization',
        valueKind: 'secret' as const,
        value: authorizationValue,
      },
    ];
  }
}
