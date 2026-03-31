import type {
  ApiDataResponse,
  CreatePlaybookInput,
  Playbook,
  UpdatePlaybookInput,
} from '../types.js';
import type { ClientTransport } from './core.js';

export async function listPlaybooks(transport: ClientTransport): Promise<Playbook[]> {
  const response = await transport.request<ApiDataResponse<Playbook[]>>('/api/v1/playbooks');
  return response.data;
}

export async function getPlaybook(
  transport: ClientTransport,
  playbookId: string,
): Promise<Playbook> {
  const response = await transport.request<ApiDataResponse<Playbook>>(
    `/api/v1/playbooks/${playbookId}`,
  );
  return response.data;
}

export async function createPlaybook(
  transport: ClientTransport,
  payload: CreatePlaybookInput,
): Promise<Playbook> {
  const response = await transport.request<ApiDataResponse<Playbook>>('/api/v1/playbooks', {
    method: 'POST',
    body: payload,
  });
  return response.data;
}

export async function updatePlaybook(
  transport: ClientTransport,
  playbookId: string,
  payload: UpdatePlaybookInput,
): Promise<Playbook> {
  const response = await transport.request<ApiDataResponse<Playbook>>(
    `/api/v1/playbooks/${playbookId}`,
    {
      method: 'PATCH',
      body: payload,
    },
  );
  return response.data;
}

export async function replacePlaybook(
  transport: ClientTransport,
  playbookId: string,
  payload: CreatePlaybookInput,
): Promise<Playbook> {
  const response = await transport.request<ApiDataResponse<Playbook>>(
    `/api/v1/playbooks/${playbookId}`,
    {
      method: 'PUT',
      body: payload,
    },
  );
  return response.data;
}

export async function archivePlaybook(
  transport: ClientTransport,
  playbookId: string,
): Promise<Playbook> {
  const response = await transport.request<ApiDataResponse<Playbook>>(
    `/api/v1/playbooks/${playbookId}/archive`,
    {
      method: 'PATCH',
      body: { archived: true },
    },
  );
  return response.data;
}

export async function restorePlaybook(
  transport: ClientTransport,
  playbookId: string,
): Promise<Playbook> {
  const response = await transport.request<ApiDataResponse<Playbook>>(
    `/api/v1/playbooks/${playbookId}/archive`,
    {
      method: 'PATCH',
      body: { archived: false },
    },
  );
  return response.data;
}

export async function deletePlaybook(
  transport: ClientTransport,
  playbookId: string,
): Promise<{ id: string; deleted: true }> {
  const response = await transport.request<ApiDataResponse<{ id: string; deleted: true }>>(
    `/api/v1/playbooks/${playbookId}`,
    {
      method: 'DELETE',
    },
  );
  return response.data;
}
