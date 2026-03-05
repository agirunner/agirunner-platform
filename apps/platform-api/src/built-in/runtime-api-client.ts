import http from 'node:http';
import https from 'node:https';

import {
  buildRuntimeTaskSubmission,
  type RuntimeTaskSubmission,
  type RuntimeTaskSubmissionOptions,
} from './worker-runtime-contract.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const LEGACY_CANCEL_FALLBACK_CODES = new Set([404, 405, 501]);

export interface RuntimeApiClientConfig {
  runtimeUrl: string;
  runtimeApiKey?: string;
  requestTimeoutMs?: number;
  allowLegacyCancelAlias?: boolean;
}

export interface RuntimeTaskCancelResult {
  method: 'post-cancel' | 'delete-legacy';
  response: Record<string, unknown>;
}

export class RuntimeApiHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseBody: string,
  ) {
    super(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function parseJsonResponse(body: string): Record<string, unknown> {
  if (body.trim().length === 0) {
    return {};
  }

  try {
    return asRecord(JSON.parse(body) as unknown);
  } catch {
    return { raw: body };
  }
}

function normalizeRuntimeBaseUrl(runtimeUrl: string): URL {
  const parsed = new URL(runtimeUrl);
  if (parsed.pathname.endsWith('/api/v1/tasks')) {
    parsed.pathname = parsed.pathname.slice(0, -'/api/v1/tasks'.length) || '/';
  }
  return parsed;
}

export class RuntimeApiClient {
  private readonly runtimeBaseUrl: URL;
  private readonly runtimeApiKey?: string;
  private readonly requestTimeoutMs: number;
  private readonly allowLegacyCancelAlias: boolean;

  constructor(config: RuntimeApiClientConfig) {
    this.runtimeBaseUrl = normalizeRuntimeBaseUrl(config.runtimeUrl);
    this.runtimeApiKey = config.runtimeApiKey;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.allowLegacyCancelAlias = config.allowLegacyCancelAlias ?? false;
  }

  submitTask(
    task: Record<string, unknown>,
    options: RuntimeTaskSubmissionOptions = {},
  ): Promise<Record<string, unknown>> {
    const submission: RuntimeTaskSubmission = buildRuntimeTaskSubmission(task, options);
    return this.requestJson('POST', '/api/v1/tasks', submission);
  }

  async cancelTask(taskId: string): Promise<RuntimeTaskCancelResult> {
    const encodedTaskId = encodeURIComponent(taskId);

    try {
      const response = await this.requestJson('POST', `/api/v1/tasks/${encodedTaskId}/cancel`, {});
      return { method: 'post-cancel', response };
    } catch (error) {
      if (
        this.allowLegacyCancelAlias &&
        error instanceof RuntimeApiHttpError &&
        LEGACY_CANCEL_FALLBACK_CODES.has(error.statusCode)
      ) {
        const response = await this.requestJson('DELETE', `/api/v1/tasks/${encodedTaskId}`);
        return { method: 'delete-legacy', response };
      }
      throw error;
    }
  }

  getTaskLogs(taskId: string): Promise<Record<string, unknown>> {
    const encodedTaskId = encodeURIComponent(taskId);
    return this.requestJson('GET', `/api/v1/tasks/${encodedTaskId}/logs`);
  }

  getHealth(): Promise<Record<string, unknown>> {
    return this.requestJson('GET', '/health');
  }

  private requestJson(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, this.runtimeBaseUrl);
    const isHttps = url.protocol === 'https:';
    const requestModule = isHttps ? https : http;
    const bodyString = body !== undefined ? JSON.stringify(body) : undefined;

    const headers: Record<string, string | number> = {
      Accept: 'application/json',
      ...(this.runtimeApiKey ? { Authorization: `Bearer ${this.runtimeApiKey}` } : {}),
      ...(bodyString
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyString),
          }
        : {}),
    };

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    };

    return new Promise((resolve, reject) => {
      const request = requestModule.request(options, (response) => {
        let responseData = '';
        response.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });

        response.on('end', () => {
          const statusCode = response.statusCode ?? 500;
          if (statusCode >= 400) {
            reject(
              new RuntimeApiHttpError(
                `Runtime API ${method} ${path} failed with HTTP ${statusCode}`,
                statusCode,
                responseData,
              ),
            );
            return;
          }

          resolve(parseJsonResponse(responseData));
        });
      });

      const timer = setTimeout(() => {
        request.destroy();
        reject(
          new RuntimeApiHttpError(
            `Runtime API ${method} ${path} timed out after ${this.requestTimeoutMs}ms`,
            408,
            '',
          ),
        );
      }, this.requestTimeoutMs);

      request.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      request.on('close', () => {
        clearTimeout(timer);
      });

      if (bodyString) {
        request.write(bodyString);
      }
      request.end();
    });
  }
}
