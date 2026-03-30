import { ValidationError } from '../../errors/domain-errors.js';

import type {
  JsonRpcEnvelope,
  JsonRpcResponsePayload,
  SseEvent,
} from './types.js';

export class SseEventReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(response: Response) {
    this.reader = response.body?.getReader() ?? null;
  }

  async nextJsonRpcMessage(expectedId: number): Promise<JsonRpcResponsePayload> {
    while (true) {
      const event = await this.nextEvent();
      if (!event?.data) {
        throw new ValidationError('Remote MCP legacy SSE stream ended before a response arrived');
      }
      const parsed = parseJsonRpcEnvelope(event.data);
      if (parsed.id !== expectedId) {
        continue;
      }
      if (parsed.error?.message) {
        throw new ValidationError(parsed.error.message);
      }
      return {
        result: parsed.result ?? {},
        sessionId: event.sessionId,
      };
    }
  }

  async nextEvent(): Promise<SseEvent | null> {
    while (true) {
      const boundary = this.buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const raw = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        if (raw.trim().length === 0) {
          continue;
        }
        return parseSseEvent(raw);
      }

      if (!this.reader) {
        return drainBufferedEvent(this.buffer);
      }

      const chunk = await this.reader.read();
      if (chunk.done) {
        return drainBufferedEvent(this.buffer);
      }
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async close() {
    await this.reader?.cancel().catch(() => undefined);
  }
}

export async function readJsonRpcResponse(
  response: Response,
  expectedId: number,
): Promise<JsonRpcResponsePayload> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const reader = new SseEventReader(response);
    try {
      const envelope = await reader.nextJsonRpcMessage(expectedId);
      return {
        result: envelope.result,
        sessionId: envelope.sessionId ?? response.headers.get('mcp-session-id'),
      };
    } finally {
      await reader.close();
    }
  }

  const parsed = parseJsonRpcEnvelope(await response.text());
  if (parsed.error?.message) {
    throw new ValidationError(parsed.error.message);
  }
  if (parsed.id !== expectedId) {
    throw new ValidationError('Remote MCP response id did not match the request');
  }
  return {
    result: parsed.result ?? {},
    sessionId: response.headers.get('mcp-session-id'),
  };
}

function drainBufferedEvent(buffer: string): SseEvent | null {
  if (buffer.trim().length === 0) {
    return null;
  }
  return parseSseEvent(buffer);
}

function parseJsonRpcEnvelope(raw: string): JsonRpcEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as JsonRpcEnvelope;
  } catch {
    throw new ValidationError('Remote MCP returned invalid JSON-RPC payload');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ValidationError('Remote MCP returned invalid JSON-RPC payload');
  }
  return parsed as JsonRpcEnvelope;
}

function parseSseEvent(raw: string): SseEvent {
  const lines = raw.split('\n');
  let event: string | null = null;
  let data = '';
  let sessionId: string | null = null;

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      const chunk = line.slice('data:'.length).trim();
      data = data ? `${data}\n${chunk}` : chunk;
      continue;
    }
    if (line.startsWith('mcp-session-id:')) {
      sessionId = line.slice('mcp-session-id:'.length).trim();
    }
  }

  return { event, data, sessionId };
}
