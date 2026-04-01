import { ServiceUnavailableError } from '../../errors/domain-errors.js';

export interface StackVersionComponentRecord {
  component: 'platform-api' | 'dashboard' | 'container-manager';
  image: string;
  image_digest: string | null;
  version: string;
  revision: string;
  status: string;
  started_at: string | null;
}

export interface StackRuntimeVersionRecord {
  image: string;
  image_digest: string | null;
  version: string;
  revision: string;
  total_containers: number;
  orchestrator_containers: number;
  specialist_runtime_containers: number;
}

export interface StackVersionSummary {
  platform_api: StackVersionComponentRecord | null;
  dashboard: StackVersionComponentRecord | null;
  container_manager: StackVersionComponentRecord | null;
  runtimes: StackRuntimeVersionRecord[];
}

export class ContainerManagerVersionReader {
  constructor(
    private readonly baseUrl: string,
    private readonly controlToken: string | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getSummary(): Promise<StackVersionSummary> {
    const endpoint = new URL('/api/v1/version-summary', this.baseUrl);
    const response = await this.fetcher(endpoint, {
      method: 'GET',
      headers: this.controlToken
        ? {
            Authorization: `Bearer ${this.controlToken}`,
          }
        : undefined,
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new ServiceUnavailableError(
        `Container manager version summary failed: ${response.status} ${rawBody || response.statusText}`,
      );
    }

    try {
      return JSON.parse(rawBody) as StackVersionSummary;
    } catch (error) {
      throw new ServiceUnavailableError(
        `Container manager version summary returned invalid JSON: ${(error as Error).message}`,
      );
    }
  }
}
