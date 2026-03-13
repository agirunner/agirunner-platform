import {
  fieldsForIntegrationKind,
  supportsHeaderEditor,
  type IntegrationFormState,
} from './integrations-page.support.js';

export interface IntegrationHeaderValidation {
  key?: string;
  value?: string;
}

export interface IntegrationValidationResult {
  fieldErrors: Record<string, string>;
  headerErrors: Record<string, IntegrationHeaderValidation>;
  issues: string[];
  isValid: boolean;
}

export function validateIntegrationForm(
  form: IntegrationFormState,
  mode: 'create' | 'edit',
): IntegrationValidationResult {
  const fieldErrors = buildFieldErrors(form, mode);
  const headerErrors = supportsHeaderEditor(form.kind)
    ? buildHeaderErrors(form.headers)
    : {};
  const issues = buildIssues(fieldErrors, headerErrors);

  return {
    fieldErrors,
    headerErrors,
    issues,
    isValid: issues.length === 0,
  };
}

function buildFieldErrors(
  form: IntegrationFormState,
  mode: 'create' | 'edit',
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fieldsForIntegrationKind(form.kind)) {
    const value = form.config[field.key]?.trim() ?? '';
    const hasStoredSecret =
      (field.key === 'secret' && Boolean(form.configuredSecrets.secret)) ||
      (field.key === 'token' && Boolean(form.configuredSecrets.token)) ||
      (field.key === 'webhook_url' && Boolean(form.configuredSecrets.webhook_url));

    if (requiresValue(form.kind, field.key) && !value && !(mode === 'edit' && hasStoredSecret)) {
      errors[field.key] = requiredMessage(field.key);
      continue;
    }

    if (value && field.type === 'url' && !isSupportedUrl(value)) {
      errors[field.key] = 'Enter a valid http:// or https:// URL.';
    }
  }

  if (form.kind === 'github_issues') {
    mergeGithubFieldErrors(errors, form.config);
  }

  return errors;
}

function mergeGithubFieldErrors(
  errors: Record<string, string>,
  config: Record<string, string>,
): void {
  const owner = config.owner?.trim() ?? '';
  const repo = config.repo?.trim() ?? '';

  const ownerError = readGithubOwnerError(owner);
  if (ownerError) {
    errors.owner = ownerError;
  }

  const repoError = readGithubRepoError(repo);
  if (repoError) {
    errors.repo = repoError;
  }
}

function readGithubOwnerError(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes('/')) {
    return 'Enter only the repository owner, not owner/repo.';
  }
  if (/\s/.test(value)) {
    return 'Repository owner cannot contain spaces.';
  }
  return undefined;
}

function readGithubRepoError(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes('/')) {
    return 'Enter only the repository name, not owner/repo.';
  }
  if (/\s/.test(value)) {
    return 'Repository name cannot contain spaces.';
  }
  if (value.endsWith('.git')) {
    return 'Use the repository name without the .git suffix.';
  }
  return undefined;
}

function buildHeaderErrors(
  headers: IntegrationFormState['headers'],
): Record<string, IntegrationHeaderValidation> {
  const errors: Record<string, IntegrationHeaderValidation> = {};
  const idsByKey = new Map<string, string[]>();

  for (const header of headers) {
    const key = header.key.trim();
    const value = header.value.trim();
    const isBlankRow = key.length === 0 && value.length === 0 && !header.hasStoredSecret;

    if (isBlankRow) {
      continue;
    }

    if (!key) {
      errors[header.id] = {
        ...errors[header.id],
        key: 'Add a header name or remove this row.',
      };
    }

    if (key && value.length === 0 && !header.hasStoredSecret) {
      errors[header.id] = {
        ...errors[header.id],
        value: 'Add a header value or remove this row.',
      };
    }

    if (key) {
      const normalized = key.toLowerCase();
      idsByKey.set(normalized, [...(idsByKey.get(normalized) ?? []), header.id]);
    }
  }

  for (const headerIds of idsByKey.values()) {
    if (headerIds.length < 2) {
      continue;
    }
    for (const headerId of headerIds) {
      errors[headerId] = {
        ...errors[headerId],
        key: 'Header names must be unique.',
      };
    }
  }

  return errors;
}

function buildIssues(
  fieldErrors: Record<string, string>,
  headerErrors: Record<string, IntegrationHeaderValidation>,
): string[] {
  const issues = new Set<string>(Object.values(fieldErrors));

  for (const headerError of Object.values(headerErrors)) {
    if (headerError.key) {
      issues.add(headerError.key);
    }
    if (headerError.value) {
      issues.add(headerError.value);
    }
  }

  return [...issues];
}

function requiresValue(kind: IntegrationFormState['kind'], key: string): boolean {
  if (kind === 'webhook') {
    return key === 'url';
  }
  if (kind === 'slack') {
    return key === 'webhook_url';
  }
  if (kind === 'otlp_http') {
    return key === 'endpoint';
  }
  return key === 'owner' || key === 'repo' || key === 'token';
}

function requiredMessage(key: string): string {
  if (key === 'url') {
    return 'Enter a destination URL.';
  }
  if (key === 'webhook_url') {
    return 'Enter a Slack webhook URL or keep the stored value.';
  }
  if (key === 'endpoint') {
    return 'Enter an OTLP endpoint.';
  }
  if (key === 'owner') {
    return 'Choose a repository owner.';
  }
  if (key === 'repo') {
    return 'Choose a repository name.';
  }
  if (key === 'token') {
    return 'Enter a GitHub access token or keep the stored value.';
  }
  return 'Complete the required field.';
}

function isSupportedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
