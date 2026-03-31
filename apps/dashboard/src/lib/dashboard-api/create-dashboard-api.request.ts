export function buildQueryString(filters?: Record<string, string>): string {
  if (!filters) {
    return '';
  }

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const rendered = params.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}

export function buildMissionControlQuery(
  values?: Record<string, string | number | undefined>,
): string {
  if (!values) {
    return '';
  }

  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    params.set(key, String(value));
  });

  const rendered = params.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}

export function buildRequestBodyWithRequestId(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const requestId =
    typeof body.request_id === 'string' && body.request_id.trim().length > 0
      ? body.request_id
      : createRequestId();
  return {
    ...body,
    request_id: requestId,
  };
}

export function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function buildHttpErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  const contentType = response.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        error?: { message?: string; details?: { issues?: unknown } };
        message?: string;
      };
      const message = payload.error?.message ?? payload.message;
      const issues = formatValidationIssueDetails(payload.error?.details?.issues);
      const detailMessage = issues ? `${message ?? 'Validation failed'} (${issues})` : message;
      return detailMessage ? `HTTP ${response.status}: ${detailMessage}` : fallback;
    }

    const text = (await response.text()).trim();
    return text ? `HTTP ${response.status}: ${text}` : fallback;
  } catch {
    return fallback;
  }
}

export function readContentDispositionFileName(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }
  const basicMatch = headerValue.match(/filename=\"?([^\";]+)\"?/i);
  return basicMatch?.[1] ?? null;
}

export function resolvePlatformPath(path: string, baseUrl: string): string {
  const resolved = new URL(path, baseUrl);
  const platformOrigin = new URL(baseUrl).origin;
  if (resolved.origin !== platformOrigin) {
    throw new Error('Artifact access must remain on the platform API origin');
  }
  return resolved.toString();
}

function formatValidationIssueDetails(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const details = value as {
    fieldErrors?: Record<string, string[] | undefined>;
    formErrors?: string[];
  };
  const fieldMessages = Object.values(details.fieldErrors ?? {})
    .flatMap((messages) => messages ?? [])
    .filter((message) => typeof message === 'string' && message.trim().length > 0);
  const formMessages = (details.formErrors ?? []).filter(
    (message) => typeof message === 'string' && message.trim().length > 0,
  );
  const messages = [...fieldMessages, ...formMessages];
  return messages.length > 0 ? messages.join(' ') : null;
}
