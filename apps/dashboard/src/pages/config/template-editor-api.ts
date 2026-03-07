import { readSession } from '../../lib/session.js';
import type { TemplateDefinition } from './template-editor-types.js';
import { createEmptyTemplate } from './template-editor-types.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

export async function fetchTemplate(id: string): Promise<TemplateDefinition> {
  const response = await fetch(`${API_BASE_URL}/api/v1/templates/${id}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    if (response.status === 404) {
      return createEmptyTemplate(id);
    }
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  const raw = body.data ?? body;
  return normalizeTemplate(id, raw);
}

export async function saveTemplateDraft(
  template: TemplateDefinition,
): Promise<TemplateDefinition> {
  const payload = { ...template, status: 'draft' };
  const response = await fetch(`${API_BASE_URL}/api/v1/templates/${template.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (response.status === 404) {
    const createResponse = await fetch(`${API_BASE_URL}/api/v1/templates`, {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!createResponse.ok) throw new Error(`HTTP ${createResponse.status}`);
    const body = await createResponse.json();
    return body.data ?? body;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

export async function publishTemplate(
  template: TemplateDefinition,
): Promise<TemplateDefinition> {
  const payload = { ...template, status: 'published' };
  const response = await fetch(`${API_BASE_URL}/api/v1/templates/${template.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

function normalizeTemplate(
  id: string,
  raw: Record<string, unknown>,
): TemplateDefinition {
  const base = createEmptyTemplate(id);
  return {
    ...base,
    ...raw,
    id,
    phases: Array.isArray(raw.phases) ? raw.phases : base.phases,
    variables: Array.isArray(raw.variables) ? raw.variables : base.variables,
    config_policy: Array.isArray(raw.config_policy) ? raw.config_policy : base.config_policy,
    lifecycle: (raw.lifecycle as TemplateDefinition['lifecycle']) ?? base.lifecycle,
  } as TemplateDefinition;
}

export function templateToJson(
  template: TemplateDefinition,
): string {
  return JSON.stringify(template, null, 2);
}
