/**
 * IT-3: MCP + SSE Stream Integration
 *
 * Verifies MCP tool calls and live SSE events are coherent:
 * - create_task via MCP emits task.created on SSE
 * - claim_task via MCP emits task.claimed on SSE
 * - complete_task via MCP emits task.completed on SSE
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { LiveContext, ScenarioExecutionResult } from '../harness/types.js';
import { createTestTenant, type TenantContext } from './tenant.js';
import { loadConfig } from '../config.js';

const config = loadConfig();

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface SseCursor {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: string;
}

function frame(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function resolveMcpEntry(): string {
  const candidates = [
    path.resolve(process.cwd(), 'dist/packages/mcp-server/src/index.js'),
    path.resolve(process.cwd(), 'packages/mcp-server/dist/index.js'),
    path.resolve(process.cwd(), 'packages/mcp-server/src/index.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate MCP server entry point. Tried: ${candidates.join(', ')}`);
}

function spawnMcpServer(apiKey: string): {
  proc: ChildProcess;
  send: (message: Record<string, unknown>) => void;
  waitForResponse: (timeoutMs?: number) => Promise<JsonRpcResponse>;
  kill: () => void;
} {
  const mcpEntry = resolveMcpEntry();

  const proc = spawn('node', [mcpEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PLATFORM_API_URL: config.apiBaseUrl,
      PLATFORM_API_TOKEN: apiKey,
    },
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
    if (stderrBuffer.length > 4_000) {
      stderrBuffer = stderrBuffer.slice(-4_000);
    }
  });

  const send = (message: Record<string, unknown>): void => {
    proc.stdin!.write(frame(JSON.stringify(message)));
  };

  const waitForResponse = (timeoutMs = 20_000): Promise<JsonRpcResponse> => {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        proc.stdout?.removeListener('data', onData);
        proc.removeListener('exit', onExit);
        proc.removeListener('error', onError);
        clearTimeout(timer);
      };

      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const stderrText = stderrBuffer.trim();
        reject(new Error(stderrText.length > 0 ? `${message} | stderr: ${stderrText}` : message));
      };

      const timer = setTimeout(() => {
        fail(`MCP response timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        fail(`MCP server exited before response (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      };

      const onError = (error: Error): void => {
        fail(`MCP server process error: ${error.message}`);
      };

      const onData = (chunk: Buffer): void => {
        stdoutBuffer += chunk.toString('utf8');

        while (true) {
          const sepIdx = stdoutBuffer.indexOf('\r\n\r\n');
          if (sepIdx === -1) return;

          const header = stdoutBuffer.slice(0, sepIdx);
          const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
          if (!lengthMatch) {
            fail(`MCP response missing Content-Length header: ${header}`);
            return;
          }

          const contentLength = Number(lengthMatch[1]);
          const bodyStart = sepIdx + 4;
          if (stdoutBuffer.length < bodyStart + contentLength) {
            return;
          }

          const body = stdoutBuffer.slice(bodyStart, bodyStart + contentLength);
          stdoutBuffer = stdoutBuffer.slice(bodyStart + contentLength);

          if (settled) return;

          settled = true;
          cleanup();

          try {
            resolve(JSON.parse(body) as JsonRpcResponse);
          } catch {
            reject(new Error(`Failed to parse MCP response JSON: ${body}`));
          }
          return;
        }
      };

      proc.stdout?.on('data', onData);
      proc.once('exit', onExit);
      proc.once('error', onError);
    });
  };

  const kill = (): void => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  };

  return { proc, send, waitForResponse, kill };
}

function extractStructuredContent(response: JsonRpcResponse): Record<string, unknown> {
  const result = response.result as { structuredContent?: unknown } | undefined;
  if (!result || typeof result !== 'object' || !('structuredContent' in result)) {
    throw new Error(`Missing structuredContent in MCP response: ${JSON.stringify(response)}`);
  }

  const structured = result.structuredContent;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    throw new Error(`Invalid structuredContent in MCP response: ${JSON.stringify(response)}`);
  }

  return structured as Record<string, unknown>;
}

async function initialize(mcp: ReturnType<typeof spawnMcpServer>): Promise<void> {
  mcp.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-harness', version: '1.0.0' },
      capabilities: {},
    },
  });

  const response = await mcp.waitForResponse();
  if (response.error) {
    throw new Error(`Initialize failed: ${JSON.stringify(response.error)}`);
  }
}

async function readSseEvent(cursor: SseCursor, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  while (true) {
    const sep = cursor.buffer.indexOf('\n\n');
    if (sep !== -1) {
      const rawEvent = cursor.buffer.slice(0, sep);
      cursor.buffer = cursor.buffer.slice(sep + 2);

      const lines = rawEvent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(':'));

      const dataLines = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim());

      if (dataLines.length === 0) {
        continue;
      }

      try {
        return JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      } catch {
        continue;
      }
    }

    const readResult = await Promise.race([cursor.reader.read(), timeout]);
    if (!readResult || !('done' in readResult)) {
      return null;
    }

    if (readResult.done) {
      return null;
    }

    cursor.buffer += new TextDecoder().decode(readResult.value, { stream: true });
  }
}

async function waitForTaskEvent(
  cursor: SseCursor,
  eventType: string,
  taskId: string,
  timeoutMs: number,
  toState?: string,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const event = await readSseEvent(cursor, remaining);
    if (!event) {
      return null;
    }

    const type = typeof event.type === 'string' ? event.type : '';
    const entityId = typeof event.entity_id === 'string' ? event.entity_id : '';

    if (type !== eventType || entityId !== taskId) {
      continue;
    }

    if (!toState) {
      return event;
    }

    const data = event.data;
    const eventToState =
      data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { to_state?: unknown }).to_state === 'string'
        ? (data as { to_state: string }).to_state
        : '';

    if (eventToState === toState) {
      return event;
    }
  }

  return null;
}

async function testMcpTaskEvents(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  const stream = await ctx.agentClient.openEventStream();
  const cursor: SseCursor = { reader: stream.reader, buffer: '' };

  const workerMcp = spawnMcpServer(ctx.workerKey);
  const agentMcp = spawnMcpServer(ctx.agentKey);

  try {
    await initialize(workerMcp);
    await initialize(agentMcp);

    workerMcp.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'create_task',
        arguments: {
          title: `IT3-mcp-sse-${Date.now()}`,
          type: 'code',
        },
      },
    });

    const createResponse = await workerMcp.waitForResponse();
    if (createResponse.error) {
      throw new Error(`create_task failed: ${JSON.stringify(createResponse.error)}`);
    }

    const createdTask = extractStructuredContent(createResponse);
    const taskId = createdTask.id;
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error(`create_task did not return a valid id: ${JSON.stringify(createdTask)}`);
    }
    validations.push('mcp_create_task_ok');

    const createdEvent = await waitForTaskEvent(cursor, 'task.created', taskId, 8_000);
    if (!createdEvent) {
      throw new Error(`SSE missing task.created for task ${taskId}`);
    }
    validations.push('sse_task_created_event_seen');

    agentMcp.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'claim_task',
        arguments: {
          agent_id: ctx.agentId,
          capabilities: ['llm-api'],
        },
      },
    });

    const claimResponse = await agentMcp.waitForResponse();
    if (claimResponse.error) {
      throw new Error(`claim_task failed: ${JSON.stringify(claimResponse.error)}`);
    }

    const claimedTask = extractStructuredContent(claimResponse);
    if (claimedTask.id !== taskId) {
      throw new Error(`claim_task returned wrong task id: expected ${taskId}, got ${String(claimedTask.id)}`);
    }
    validations.push('mcp_claim_task_ok');

    const claimedEvent = await waitForTaskEvent(cursor, 'task.state_changed', taskId, 8_000, 'claimed');
    if (!claimedEvent) {
      throw new Error(`SSE missing task.state_changed(to_state=claimed) for task ${taskId}`);
    }
    validations.push('sse_task_claimed_event_seen');

    await ctx.agentClient.startTask(taskId, { agent_id: ctx.agentId });
    validations.push('task_started_before_complete');

    agentMcp.send({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'complete_task',
        arguments: {
          id: taskId,
          output: { result: 'completed via IT-3 MCP SSE test' },
        },
      },
    });

    const completeResponse = await agentMcp.waitForResponse();
    if (completeResponse.error) {
      throw new Error(`complete_task failed: ${JSON.stringify(completeResponse.error)}`);
    }

    const completedTask = extractStructuredContent(completeResponse);
    if (completedTask.id !== taskId) {
      throw new Error(`complete_task returned wrong task id: expected ${taskId}, got ${String(completedTask.id)}`);
    }
    validations.push('mcp_complete_task_ok');

    const completedEvent = await waitForTaskEvent(cursor, 'task.state_changed', taskId, 8_000, 'completed');
    if (!completedEvent) {
      throw new Error(`SSE missing task.state_changed(to_state=completed) for task ${taskId}`);
    }
    validations.push('sse_task_completed_event_seen');
  } finally {
    stream.abort();
    workerMcp.kill();
    agentMcp.kill();
  }

  return validations;
}

export async function runIt3McpSseStream(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const _live = live;
  void _live;

  const ctx = await createTestTenant('it3-mcp-sse-stream');
  const allValidations: string[] = [];

  try {
    allValidations.push(...await testMcpTaskEvents(ctx));
  } finally {
    await ctx.cleanup();
  }

  return {
    name: 'it3-mcp-sse-stream',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
