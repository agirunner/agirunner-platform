import { z } from 'zod';

import type { DatabaseQueryable } from '../../db/database.js';
import { NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import type { StoredRemoteMcpServerRecord } from '../remote-mcp-server-service.js';
import {
  remoteMcpOauthDefinitionSchema,
  remoteMcpParameterSchema,
  remoteMcpTransportPreferenceSchema,
} from '../remote-mcp-model.js';
import type { RemoteMcpOAuthStatePayload } from '../remote-mcp-oauth-types.js';
import { persistableOauthDefinition } from './remote-mcp-oauth-helpers.js';

export const draftInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  endpointUrl: z.string().min(1).max(2000),
  transportPreference: remoteMcpTransportPreferenceSchema.default('auto'),
  callTimeoutSeconds: z.number().int().min(1).max(86400).default(300),
  authMode: z.literal('oauth'),
  enabledByDefaultForNewSpecialists: z.boolean().default(false),
  grantToAllExistingSpecialists: z.boolean().default(false),
  oauthClientProfileId: z.string().uuid().nullable().optional(),
  oauthDefinition: remoteMcpOauthDefinitionSchema.nullable().optional(),
  parameters: z.array(remoteMcpParameterSchema).default([]),
}).strict();

export interface StateRow {
  tenant_id: string;
  user_id: string;
  code_verifier: string;
  flow_kind: string;
  flow_payload: unknown;
}

export interface DraftRow {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  description: string;
  endpoint_url: string;
  transport_preference: 'auto' | 'streamable_http' | 'http_sse_compat';
  call_timeout_seconds: number;
  auth_mode: 'oauth';
  enabled_by_default_for_new_specialists: boolean;
  grant_to_all_existing_specialists: boolean;
  oauth_client_profile_id: string | null;
  oauth_definition: unknown;
  parameters: unknown;
}

export type DraftInput = z.input<typeof draftInputSchema>;

export async function createOAuthDraft(
  pool: DatabaseQueryable,
  tenantId: string,
  userId: string,
  validated: z.infer<typeof draftInputSchema>,
): Promise<string> {
  const draftInsert = await pool.query<{ id: string }>(
    `INSERT INTO remote_mcp_registration_drafts (
       tenant_id, user_id, name, description, endpoint_url, auth_mode,
       transport_preference, call_timeout_seconds, enabled_by_default_for_new_specialists,
       grant_to_all_existing_specialists, oauth_client_profile_id, oauth_definition, parameters
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
     RETURNING id`,
    [
      tenantId,
      userId,
      validated.name.trim(),
      validated.description.trim(),
      validated.endpointUrl.trim(),
      'oauth',
      validated.transportPreference,
      validated.callTimeoutSeconds,
      validated.enabledByDefaultForNewSpecialists,
      validated.grantToAllExistingSpecialists,
      validated.oauthClientProfileId ?? null,
      JSON.stringify(persistableOauthDefinition(validated.oauthDefinition ?? null)),
      JSON.stringify(validated.parameters),
    ],
  );
  const draftId = draftInsert.rows[0]?.id;
  if (!draftId) {
    throw new ValidationError('Unable to create remote MCP OAuth draft');
  }
  return draftId;
}

export async function insertOAuthState(
  pool: DatabaseQueryable,
  tenantId: string,
  userId: string,
  state: string,
  codeVerifier: string,
  flowPayload: RemoteMcpOAuthStatePayload,
): Promise<void> {
  await pool.query(
    `INSERT INTO oauth_states (
       tenant_id, user_id, profile_id, flow_kind, flow_payload, state, code_verifier, expires_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW() + INTERVAL '10 minutes')`,
    [
      tenantId,
      userId,
      'remote_mcp',
      'remote_mcp',
      JSON.stringify(flowPayload),
      state,
      codeVerifier,
    ],
  );
}

export async function consumeState(
  pool: DatabaseQueryable,
  state: string,
): Promise<StateRow> {
  await pool.query('DELETE FROM oauth_states WHERE expires_at < NOW()');
  const result = await pool.query<StateRow>(
    `DELETE FROM oauth_states
     WHERE state = $1
       AND expires_at > NOW()
     RETURNING tenant_id, user_id, code_verifier, flow_kind, flow_payload`,
    [state],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ValidationError('Invalid or expired OAuth state. The authorization flow may have timed out. Please try again.');
  }
  return row;
}

export async function loadState(
  pool: DatabaseQueryable,
  state: string,
): Promise<StateRow> {
  await pool.query('DELETE FROM oauth_states WHERE expires_at < NOW()');
  const result = await pool.query<StateRow>(
    `SELECT tenant_id, user_id, code_verifier, flow_kind, flow_payload
       FROM oauth_states
      WHERE state = $1
        AND expires_at > NOW()`,
    [state],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ValidationError('Invalid or expired OAuth state. The authorization flow may have timed out. Please try again.');
  }
  return row;
}

export async function deleteState(
  pool: DatabaseQueryable,
  state: string,
): Promise<void> {
  await pool.query('DELETE FROM oauth_states WHERE state = $1', [state]);
}

export async function loadDraft(
  pool: DatabaseQueryable,
  tenantId: string,
  draftId: string,
): Promise<DraftRow> {
  const result = await pool.query<DraftRow>(
    `SELECT *
       FROM remote_mcp_registration_drafts
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, draftId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError('Remote MCP OAuth draft not found');
  }
  return row;
}

export async function deleteDraft(
  pool: DatabaseQueryable,
  draftId: string,
): Promise<void> {
  await pool.query(
    'DELETE FROM remote_mcp_registration_drafts WHERE id = $1',
    [draftId],
  );
}

export async function loadServerAsDraft(
  serverService: {
    getStoredServer(tenantId: string, id: string): Promise<StoredRemoteMcpServerRecord>;
  },
  tenantId: string,
  serverId: string,
): Promise<DraftRow> {
  const current = await serverService.getStoredServer(tenantId, serverId);
  return {
    id: current.id,
    tenant_id: current.tenant_id,
    user_id: '',
    name: current.name,
    description: current.description,
    endpoint_url: current.endpoint_url,
    transport_preference: current.transport_preference,
    call_timeout_seconds: current.call_timeout_seconds,
    auth_mode: 'oauth',
    oauth_client_profile_id: current.oauth_client_profile_id,
    enabled_by_default_for_new_specialists: current.enabled_by_default_for_new_specialists,
    grant_to_all_existing_specialists: false,
    oauth_definition: current.oauth_definition,
    parameters: current.parameters.map((parameter) => ({
      placement: parameter.placement,
      key: parameter.key,
      valueKind: parameter.value_kind,
      value: parameter.value,
    })),
  };
}
