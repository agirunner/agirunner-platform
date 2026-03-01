/**
 * IT-2: MCP Server Integration Tests
 *
 * Tests the MCP (Model Context Protocol) server's JSON-RPC transport
 * by spawning it as a child process and sending framed messages
 * via stdin/stdout.
 *
 * Verifies:
 * - Server starts and responds to `initialize` handshake
 * - `tools/list` returns the expected tool list
 * - `tools/call` invokes list_tasks/create_task/claim_task/complete_task
 * - Malformed JSON produces JSON-RPC -32700
 * - Missing required params produce JSON-RPC -32602
 *
 * Test plan ref: Section 4, IT-2
 * FR refs: FR-400–FR-410 (MCP)
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

/**
 * Spawns the MCP server and provides request/response helpers.
 */
function spawnMcpServer(apiKey: string): {
  proc: ChildProcess;
  send: (message: Record<string, unknown>) => void;
  sendRawBody: (body: string) => void;
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

  let buffer = '';
  let stderrBuffer = '';

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
    if (stderrBuffer.length > 4_000) {
      stderrBuffer = stderrBuffer.slice(-4_000);
    }
  });

  const send = (message: Record<string, unknown>): void => {
    const body = JSON.stringify(message);
    proc.stdin!.write(frame(body));
  };

  const sendRawBody = (body: string): void => {
    proc.stdin!.write(frame(body));
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
        if (settled) {
          return;
        }
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
        buffer += chunk.toString('utf8');

        while (true) {
          const sepIdx = buffer.indexOf('\r\n\r\n');
          if (sepIdx === -1) {
            return;
          }

          const header = buffer.slice(0, sepIdx);
          const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
          if (!lengthMatch) {
            fail(`MCP response missing Content-Length header: ${header}`);
            return;
          }

          const contentLength = Number(lengthMatch[1]);
          const bodyStart = sepIdx + 4;
          if (buffer.length < bodyStart + contentLength) {
            return;
          }

          const body = buffer.slice(bodyStart, bodyStart + contentLength);
          buffer = buffer.slice(bodyStart + contentLength);

          if (settled) {
            return;
          }

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

  return { proc, send, sendRawBody, waitForResponse, kill };
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

/**
 * Test: MCP server responds to `initialize`.
 */
async function testInitialize(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];
  const mcp = spawnMcpServer(ctx.agentKey);

  try {
    await initialize(mcp);
    validations.push('mcp_initialize_ok');

    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const response = await mcp.waitForResponse();
    if (response.error) throw new Error(`Post-init tools/list failed: ${JSON.stringify(response.error)}`);
    validations.push('mcp_post_init_request_ok');
  } finally {
    mcp.kill();
  }

  return validations;
}

/**
 * Test: `tools/list` returns available tools.
 */
async function testToolsList(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];
  const mcp = spawnMcpServer(ctx.agentKey);

  try {
    await initialize(mcp);

    mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
    const response = await mcp.waitForResponse();

    if (response.error) {
      throw new Error(`tools/list failed: ${JSON.stringify(response.error)}`);
    }

    const result = response.result as { tools?: Array<{ name: string }> };
    if (!result.tools || !Array.isArray(result.tools)) {
      throw new Error('tools/list did not return a tools array');
    }

    const names = result.tools.map((t) => t.name);
    const required = ['list_tasks', 'create_task', 'claim_task', 'complete_task'];
    for (const toolName of required) {
      if (!names.includes(toolName)) {
        throw new Error(`tools/list missing required tool: ${toolName}`);
      }
    }

    validations.push('mcp_tools_list_ok');
    validations.push(`mcp_tools_count:${result.tools.length}`);
  } finally {
    mcp.kill();
  }

  return validations;
}

/**
 * Test: tools/call covers list_tasks/create_task/claim_task/complete_task.
 */
async function testToolCalls(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];

  let createdTaskId: string;

  const workerMcp = spawnMcpServer(ctx.workerKey);
  try {
    await initialize(workerMcp);

    workerMcp.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'create_task',
        arguments: {
          title: 'IT2 MCP create_task',
          type: 'code',
        },
      },
    });

    const createRes = await workerMcp.waitForResponse();
    if (createRes.error) throw new Error(`create_task failed: ${JSON.stringify(createRes.error)}`);

    const createdTask = extractStructuredContent(createRes);
    const taskId = createdTask.id;
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error(`create_task did not return a valid task id: ${JSON.stringify(createdTask)}`);
    }

    createdTaskId = taskId;
    validations.push('mcp_tools_call:create_task');
  } finally {
    workerMcp.kill();
  }

  const agentMcp = spawnMcpServer(ctx.agentKey);
  try {
    await initialize(agentMcp);

    agentMcp.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'list_tasks',
        arguments: {},
      },
    });

    const listRes = await agentMcp.waitForResponse();
    if (listRes.error) throw new Error(`list_tasks failed: ${JSON.stringify(listRes.error)}`);

    const listed = extractStructuredContent(listRes);
    const listData = listed.data;
    if (!Array.isArray(listData)) {
      throw new Error(`list_tasks did not return data array: ${JSON.stringify(listed)}`);
    }
    if (!listData.some((task) => typeof task === 'object' && task !== null && (task as { id?: unknown }).id === createdTaskId)) {
      throw new Error(`list_tasks did not include created task ${createdTaskId}`);
    }
    validations.push('mcp_tools_call:list_tasks');

    agentMcp.send({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'claim_task',
        arguments: {
          agent_id: ctx.agentId,
          capabilities: ['llm-api'],
        },
      },
    });

    const claimRes = await agentMcp.waitForResponse();
    if (claimRes.error) throw new Error(`claim_task failed: ${JSON.stringify(claimRes.error)}`);

    const claimedTask = extractStructuredContent(claimRes);
    if (claimedTask.id !== createdTaskId) {
      throw new Error(`claim_task claimed unexpected task: expected ${createdTaskId}, got ${String(claimedTask.id)}`);
    }
    validations.push('mcp_tools_call:claim_task');

    agentMcp.send({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'complete_task',
        arguments: {
          id: createdTaskId,
          output: { result: 'completed via MCP test' },
        },
      },
    });

    const completeRes = await agentMcp.waitForResponse();
    if (completeRes.error) throw new Error(`complete_task failed: ${JSON.stringify(completeRes.error)}`);

    const completedTask = extractStructuredContent(completeRes);
    if (completedTask.id !== createdTaskId) {
      throw new Error(`complete_task returned unexpected task id: expected ${createdTaskId}, got ${String(completedTask.id)}`);
    }
    validations.push('mcp_tools_call:complete_task');
  } finally {
    agentMcp.kill();
  }

  return validations;
}

/**
 * Test: Malformed message and missing params return specific JSON-RPC errors.
 */
async function testProtocolErrors(ctx: TenantContext): Promise<string[]> {
  const validations: string[] = [];
  const mcp = spawnMcpServer(ctx.agentKey);

  try {
    await initialize(mcp);

    // Malformed JSON payload must return parse error -32700.
    mcp.sendRawBody('{"jsonrpc":"2.0","id":200,"method":"tools/list","params":');
    const malformedRes = await mcp.waitForResponse(5_000);
    if (!malformedRes.error || malformedRes.error.code !== -32700) {
      throw new Error(`Expected malformed JSON error code -32700, got: ${JSON.stringify(malformedRes)}`);
    }
    validations.push('mcp_error_malformed:-32700');

    // Missing required params must return invalid params -32602.
    mcp.send({
      jsonrpc: '2.0',
      id: 201,
      method: 'tools/call',
      params: {
        name: 'create_task',
        arguments: {
          type: 'code',
        },
      },
    });

    const missingParamsRes = await mcp.waitForResponse(5_000);
    if (!missingParamsRes.error || missingParamsRes.error.code !== -32602) {
      throw new Error(`Expected missing-params error code -32602, got: ${JSON.stringify(missingParamsRes)}`);
    }
    validations.push('mcp_error_missing_params:-32602');
  } finally {
    mcp.kill();
  }

  return validations;
}

/**
 * Main IT-2 runner.
 */
export async function runIt2Mcp(
  live: LiveContext,
): Promise<ScenarioExecutionResult> {
  const ctx = await createTestTenant('it2-mcp');
  const allValidations: string[] = [];

  try {
    allValidations.push(...await testInitialize(ctx));
    allValidations.push(...await testToolsList(ctx));
    allValidations.push(...await testToolCalls(ctx));
    allValidations.push(...await testProtocolErrors(ctx));
  } finally {
    await ctx.cleanup();
  }

  return {
    name: 'it2-mcp',
    costUsd: 0,
    artifacts: [],
    validations: allValidations,
    screenshots: [],
  };
}
