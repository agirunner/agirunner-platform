import { readSession } from '../../lib/session.js';
import type { RuntimeDefault } from './runtime-defaults.types.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

export async function fetchRuntimeDefaults(): Promise<RuntimeDefault[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

export async function upsertRuntimeDefault(input: {
  configKey: string;
  configValue: string;
  configType: 'string' | 'number';
  description: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function deleteRuntimeDefault(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
