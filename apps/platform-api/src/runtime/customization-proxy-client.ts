import { ServiceUnavailableError } from '../errors/domain-errors.js';

const CUSTOMIZATION_BASE_PATH = '/v1/runtime/customizations';

export interface RuntimeCustomizationProxyClientOptions {
  runtimeUrl?: string;
  runtimeApiKey?: string;
  fetchFn?: typeof fetch;
}

export interface RuntimeCustomizationProxyResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export class RuntimeCustomizationProxyClient {
  private readonly fetchFn: typeof fetch;
  private readonly runtimeApiKey?: string;
  private readonly runtimeBaseUrl: URL;

  constructor(options: RuntimeCustomizationProxyClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.runtimeApiKey = options.runtimeApiKey;
    this.runtimeBaseUrl = resolveRuntimeBaseUrl(options.runtimeUrl);
  }

  getStatus(): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('GET', '/status');
  }

  validate(payload: Record<string, unknown>): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('POST', '/validate', payload);
  }

  createBuild(payload: Record<string, unknown>): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('POST', '/builds', payload);
  }

  getBuild(buildId: string): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('GET', `/builds/${encodeURIComponent(buildId)}`);
  }

  createLink(payload: Record<string, unknown>): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('POST', '/links', payload);
  }

  rollback(payload: Record<string, unknown>): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('POST', '/rollback', payload);
  }

  reconstruct(payload: Record<string, unknown>): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('POST', '/reconstruct', payload);
  }

  exportReconstructedArtifact(
    payload: Record<string, unknown>,
  ): Promise<RuntimeCustomizationProxyResponse> {
    return this.request('POST', '/reconstruct/export', payload);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<RuntimeCustomizationProxyResponse> {
    const response = await this.fetchRuntime(method, path, payload);
    const body = await parseJsonBody(response);
    return {
      statusCode: response.status,
      body,
    };
  }

  private fetchRuntime(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<Response> {
    const headers = buildHeaders(this.runtimeApiKey, payload !== undefined);
    return this.fetchFn(new URL(`${CUSTOMIZATION_BASE_PATH}${path}`, this.runtimeBaseUrl), {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    }).catch((error: unknown) => {
      throw new ServiceUnavailableError('Runtime customization service is unavailable', {
        cause: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function resolveRuntimeBaseUrl(runtimeUrl?: string): URL {
  if (!runtimeUrl || runtimeUrl.trim().length === 0) {
    throw new ServiceUnavailableError('RUNTIME_URL is required for runtime customization proxy');
  }

  const parsed = new URL(runtimeUrl);
  for (const suffix of ['/api/v1/tasks', CUSTOMIZATION_BASE_PATH]) {
    if (parsed.pathname.endsWith(suffix)) {
      parsed.pathname = parsed.pathname.slice(0, -suffix.length) || '/';
    }
  }

  return parsed;
}

function buildHeaders(runtimeApiKey: string | undefined, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (runtimeApiKey) {
    headers['X-API-Key'] = runtimeApiKey;
  }
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  const bodyText = await response.text();
  if (bodyText.trim().length === 0) {
    return {};
  }

  try {
    const body = JSON.parse(bodyText) as unknown;
    return isRecord(body) ? body : { value: body };
  } catch {
    return { raw: bodyText };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
