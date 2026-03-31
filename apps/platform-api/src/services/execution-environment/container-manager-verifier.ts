import { ValidationError } from '../../errors/domain-errors.js';
import type { ExecutionEnvironmentVerificationResult } from './contract.js';
import type { ExecutionEnvironmentVerifier } from './verification-service.js';

interface VerificationResponseBody extends ExecutionEnvironmentVerificationResult {}

export class ContainerManagerExecutionEnvironmentVerifier
  implements ExecutionEnvironmentVerifier
{
  constructor(
    private readonly baseUrl: string,
    private readonly controlToken: string | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verify(input: {
    environmentId: string;
    image: string;
    cpu: string;
    memory: string;
    pullPolicy: 'always' | 'if-not-present' | 'never';
    bootstrapCommands: string[];
    bootstrapRequiredDomains: string[];
  }): Promise<ExecutionEnvironmentVerificationResult> {
    const endpoint = new URL('/api/v1/execution-environments/verify', this.baseUrl);
    const response = await this.fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.controlToken ? { Authorization: `Bearer ${this.controlToken}` } : {}),
      },
      body: JSON.stringify({
        environmentId: input.environmentId,
        image: input.image,
        cpu: input.cpu,
        memory: input.memory,
        pullPolicy: input.pullPolicy,
        bootstrapCommands: input.bootstrapCommands,
        bootstrapRequiredDomains: input.bootstrapRequiredDomains,
      }),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new ValidationError(
        `Execution environment verification failed: ${response.status} ${rawBody || response.statusText}`,
      );
    }

    let parsed: VerificationResponseBody;
    try {
      parsed = JSON.parse(rawBody) as VerificationResponseBody;
    } catch (error) {
      throw new ValidationError(
        `Execution environment verification returned invalid JSON: ${(error as Error).message}`,
      );
    }

    return parsed;
  }
}
