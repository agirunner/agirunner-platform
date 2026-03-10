import { readSession } from '../../lib/session.js';
import type { TemplateResponse, TemplateEditorState } from './template-editor-types.js';
import {
  createEmptyTemplate,
  responseToEditorState,
  editorStateToCreatePayload,
  editorStateToPatchPayload,
} from './template-editor-types.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
    credentials: 'include',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Template CRUD
// ---------------------------------------------------------------------------

export interface TemplateListResponse {
  data: TemplateResponse[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

export interface TemplateListParams {
  q?: string;
  slug?: string;
  is_built_in?: boolean;
  page?: number;
  per_page?: number;
}

export async function listTemplates(params: TemplateListParams = {}): Promise<TemplateListResponse> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set('q', params.q);
  if (params.slug) searchParams.set('slug', params.slug);
  if (params.is_built_in !== undefined) searchParams.set('is_built_in', String(params.is_built_in));
  if (params.page) searchParams.set('page', String(params.page));
  if (params.per_page) searchParams.set('per_page', String(params.per_page));

  const qs = searchParams.toString();
  const url = `${API_BASE_URL}/api/v1/templates${qs ? `?${qs}` : ''}`;
  return requestJson<TemplateListResponse>(url);
}

export async function fetchTemplate(id: string): Promise<TemplateEditorState> {
  const body = await requestJson<{ data: TemplateResponse }>(
    `${API_BASE_URL}/api/v1/templates/${id}`,
  );
  return responseToEditorState(body.data);
}

export async function createTemplate(state: TemplateEditorState): Promise<TemplateEditorState> {
  const body = await requestJson<{ data: TemplateResponse }>(
    `${API_BASE_URL}/api/v1/templates`,
    {
      method: 'POST',
      body: JSON.stringify(editorStateToCreatePayload(state)),
    },
  );
  return responseToEditorState(body.data);
}

export async function saveTemplate(state: TemplateEditorState): Promise<TemplateEditorState> {
  const body = await requestJson<{ data: TemplateResponse }>(
    `${API_BASE_URL}/api/v1/templates/${state.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(editorStateToPatchPayload(state)),
    },
  );
  return responseToEditorState(body.data);
}

export async function publishTemplate(state: TemplateEditorState): Promise<TemplateEditorState> {
  const body = await requestJson<{ data: TemplateResponse }>(
    `${API_BASE_URL}/api/v1/templates/${state.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_published: true }),
    },
  );
  return responseToEditorState(body.data);
}

export async function deleteTemplate(id: string): Promise<void> {
  await requestJson<{ data: TemplateResponse }>(
    `${API_BASE_URL}/api/v1/templates/${id}`,
    { method: 'DELETE' },
  );
}

export async function cloneTemplate(templateId: string): Promise<TemplateEditorState> {
  const original = await fetchTemplate(templateId);
  return createTemplate({
    ...original,
    id: '',
    name: `${original.name} (Copy)`,
    slug: `${original.slug}-copy`,
    version: 1,
    is_published: false,
    created_at: undefined,
    updated_at: undefined,
  });
}

export function templateToJson(state: TemplateEditorState): string {
  return JSON.stringify(state.schema, null, 2);
}
