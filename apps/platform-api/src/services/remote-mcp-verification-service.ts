import { ValidationError } from '../errors/domain-errors.js';
import type {
  CreateVerifiedRemoteMcpServerInput,
  RemoteMcpOAuthConfigRecord,
  RemoteMcpOAuthCredentialsRecord,
  RemoteMcpServerService,
  StoredRemoteMcpServerRecord,
  UpdateVerifiedRemoteMcpServerInput,
} from './remote-mcp-server-service.js';

export interface RemoteMcpVerifier {
  verify(input: {
    endpointUrl: string;
    authMode: 'none' | 'parameterized' | 'oauth';
    parameters: Array<{
      placement: 'path' | 'query' | 'header' | 'initialize_param';
      key: string;
      valueKind: 'static' | 'secret';
      value: string;
    }>;
  }): Promise<{
    verification_status: 'unknown' | 'verified' | 'failed';
    verification_error: string | null;
    verified_transport: 'streamable_http' | 'http_sse_compat' | null;
    verification_contract_version: string;
    discovered_tools_snapshot: Array<Record<string, unknown>>;
  }>;
}

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
    input: Omit<
      CreateVerifiedRemoteMcpServerInput,
      | 'verificationStatus'
      | 'verificationError'
      | 'verifiedTransport'
      | 'verificationContractVersion'
      | 'discoveredToolsSnapshot'
    >,
  ) {
    const verification = await this.verifyOrThrow(input.endpointUrl, input.authMode, input.parameters);
    return this.serverService.createVerifiedServer(tenantId, {
      ...input,
      verificationStatus: verification.verification_status,
      verificationError: verification.verification_error,
      verifiedTransport: verification.verified_transport,
      verificationContractVersion: verification.verification_contract_version,
      discoveredToolsSnapshot: verification.discovered_tools_snapshot,
    });
  }

  async updateServer(
    tenantId: string,
    id: string,
    input: Omit<
      UpdateVerifiedRemoteMcpServerInput,
      | 'verificationStatus'
      | 'verificationError'
      | 'verifiedTransport'
      | 'verificationContractVersion'
      | 'discoveredToolsSnapshot'
    >,
  ) {
    const current = await this.serverService.getStoredServer(tenantId, id);
    const connectivityChanged =
      (input.endpointUrl !== undefined && input.endpointUrl !== current.endpoint_url)
      || (input.authMode !== undefined && input.authMode !== current.auth_mode)
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
      current.auth_mode,
      parameters,
    );
    return this.serverService.updateVerificationResult(tenantId, id, {
      verificationStatus: verification.verification_status,
      verificationError: verification.verification_error,
      verifiedTransport: verification.verified_transport,
      verificationContractVersion: verification.verification_contract_version,
      discoveredToolsSnapshot: verification.discovered_tools_snapshot,
    });
  }

  private async verifyOrThrow(
    endpointUrl: string,
    authMode: 'none' | 'parameterized' | 'oauth',
    parameters: Array<{
      placement: 'path' | 'query' | 'header' | 'initialize_param';
      key: string;
      valueKind: 'static' | 'secret';
      value: string;
    }>,
  ) {
    const verification = await this.verifier.verify({ endpointUrl, authMode, parameters });
    if (!Array.isArray(verification.discovered_tools_snapshot) || verification.discovered_tools_snapshot.length === 0) {
      throw new ValidationError('Remote MCP verification discovered zero tools');
    }
    return verification;
  }

  private async buildVerificationParameters(
    current: Pick<StoredRemoteMcpServerRecord, 'id' | 'oauth_config' | 'oauth_credentials'>,
    authMode: 'none' | 'parameterized' | 'oauth',
    parameters: Array<{
      placement: 'path' | 'query' | 'header' | 'initialize_param';
      key: string;
      valueKind: 'static' | 'secret';
      value: string;
    }>,
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
