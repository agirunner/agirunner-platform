import { stdout } from 'node:process';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function writeMessage(payload: JsonRpcResponse): void {
  const body = JSON.stringify(payload);
  stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

/**
 * Creates a streaming message processor for the JSON-RPC over stdio transport.
 *
 * Handles Content-Length framing, JSON parsing, and error recovery.
 * Never throws or crashes on malformed input — returns JSON-RPC `-32700`
 * (Parse Error) responses instead.
 */
export function createMessageProcessor(
  onMessage: (message: JsonRpcRequest) => Promise<void>,
  onMalformedMessage: (error: JsonRpcResponse) => void,
): (chunk: Buffer) => void {
  let buffer = '';

  return (chunk: Buffer) => {
    buffer += chunk.toString('utf8');

    while (true) {
      const separatorIndex = buffer.indexOf('\r\n\r\n');
      if (separatorIndex === -1) return;

      const header = buffer.slice(0, separatorIndex);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        buffer = '';
        onMalformedMessage(parseError('Missing Content-Length header'));
        return;
      }

      const contentLength = Number(lengthMatch[1]);
      const start = separatorIndex + 4;
      const end = start + contentLength;
      if (buffer.length < end) return;

      const body = buffer.slice(start, end);
      buffer = buffer.slice(end);

      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(body) as JsonRpcRequest;
      } catch {
        onMalformedMessage(parseError('Malformed JSON payload'));
        continue;
      }

      onMessage(parsed).catch(() => {
        onMalformedMessage(parseError('Internal error processing message'));
      });
    }
  };
}

function parseError(message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: null, error: { code: -32700, message } };
}
