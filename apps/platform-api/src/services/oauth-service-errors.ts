import { ServiceUnavailableError, ValidationError } from '../errors/domain-errors.js';

const PROVIDER_ERROR_MAX_LENGTH = 160;
const PROVIDER_REFRESH_REAUTH_PATTERNS = [
  /\binvalid_grant\b/i,
  /\brefresh token\b.*\binvalid\b/i,
  /\brefresh token\b.*\bexpired\b/i,
  /\brefresh token\b.*\brevoked\b/i,
  /\breauthor/i,
  /\bre-author/i,
  /\bconsent_required\b/i,
  /\blogin_required\b/i,
] as const;

export function buildProviderReauthRequiredError(providerId: string): ValidationError {
  return new ValidationError(
    'OAuth session expired. An admin must reconnect on the LLM Providers page.',
    {
      category: 'provider_reauth_required',
      retryable: false,
      recoverable: false,
      recovery_hint: 'reconnect_oauth_provider',
      recovery: {
        status: 'operator_action_required',
        reason: 'provider_reauth_required',
        provider_id: providerId,
      },
    },
  );
}

export function buildProviderRefreshReauthSignal(): ValidationError {
  return new ValidationError('OAuth refresh requires reauthorization.', {
    category: 'provider_reauth_required',
  });
}

export function isProviderReauthRequiredFailure(error: unknown): boolean {
  return error instanceof ValidationError && error.details?.category === 'provider_reauth_required';
}

export function buildProviderCredentialsUnavailableError(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    'Stored OAuth credentials are unavailable. Verify platform secret configuration before retrying.',
    {
      category: 'provider_credentials_unavailable',
      retryable: false,
      recoverable: false,
    },
  );
}

export function buildOAuthRefreshUnavailableError(
  status?: number,
  rawDetail?: string,
): ServiceUnavailableError {
  const detail = sanitizeProviderErrorDetail(rawDetail ?? '');
  const message = status == null
    ? 'OAuth token refresh is temporarily unavailable.'
    : detail
      ? `OAuth token refresh is temporarily unavailable (${status}): ${detail}`
      : `OAuth token refresh is temporarily unavailable (${status}).`;
  return new ServiceUnavailableError(message, {
    category: 'provider_oauth_refresh_unavailable',
    retryable: true,
    recoverable: true,
  });
}

export function isProviderRefreshReauthStatus(status: number, rawDetail: string): boolean {
  if (status !== 400 && status !== 401 && status !== 403) {
    return false;
  }
  const normalized = rawDetail.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return PROVIDER_REFRESH_REAUTH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildOAuthTokenExchangeErrorMessage(status: number, rawDetail: string): string {
  const sanitized = sanitizeProviderErrorDetail(rawDetail);
  if (!sanitized) {
    return `OAuth token exchange failed with status ${status}`;
  }
  return `OAuth token exchange failed with status ${status}: ${sanitized}`;
}

function sanitizeProviderErrorDetail(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  if (containsSecretLikeValue(normalized)) {
    return null;
  }
  return normalized.length > PROVIDER_ERROR_MAX_LENGTH
    ? `${normalized.slice(0, PROVIDER_ERROR_MAX_LENGTH - 1)}...`
    : normalized;
}

function containsSecretLikeValue(value: string): boolean {
  return (
    /(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|bearer|api[_-]?key|password|secret)/i.test(value)
    || /enc:v\d+:/i.test(value)
    || /secret:[A-Z0-9_:-]+/i.test(value)
    || /Bearer\s+\S+/i.test(value)
    || /\b(?:sk|rk|ghp|ghu|github_pat)_[A-Za-z0-9_-]{8,}\b/.test(value)
    || /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
  );
}
