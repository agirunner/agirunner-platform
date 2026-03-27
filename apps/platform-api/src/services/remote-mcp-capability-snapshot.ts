import { ValidationError } from '../errors/domain-errors.js';

export interface RemoteMcpCapabilitySummary extends Record<string, unknown> {
  tool_count: number;
  resource_count: number;
  prompt_count: number;
}

export function normalizeRemoteMcpToolSnapshot(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new ValidationError('Remote MCP tools/list response did not include a tools array');
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const name = readString(entry.name);
    if (!name) {
      return [];
    }
    return [{
      original_name: name,
      description: readString(entry.description),
      input_schema: isRecord(entry.inputSchema)
        ? entry.inputSchema
        : isRecord(entry.input_schema)
          ? entry.input_schema
          : {},
    }];
  });
}

export function normalizeRemoteMcpResourceSnapshot(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new ValidationError('Remote MCP resources/list response did not include a resources array');
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const uri = readString(entry.uri);
    if (!uri) {
      return [];
    }
    return [{
      uri,
      name: readString(entry.name),
      description: readString(entry.description),
      mime_type: readString(entry.mimeType) ?? readString(entry.mime_type),
    }];
  });
}

export function normalizeRemoteMcpPromptSnapshot(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new ValidationError('Remote MCP prompts/list response did not include a prompts array');
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const name = readString(entry.name);
    if (!name) {
      return [];
    }
    return [{
      name,
      description: readString(entry.description),
      arguments: Array.isArray(entry.arguments)
        ? entry.arguments.filter(isRecord).map((argument) => ({
            name: readString(argument.name),
            description: readString(argument.description),
            required: argument.required === true,
          }))
        : [],
    }];
  });
}

export function buildRemoteMcpCapabilitySummary(
  tools: Array<Record<string, unknown>>,
  resources: Array<Record<string, unknown>>,
  prompts: Array<Record<string, unknown>>,
): RemoteMcpCapabilitySummary {
  return {
    tool_count: tools.length,
    resource_count: resources.length,
    prompt_count: prompts.length,
  };
}

export function hasRemoteMcpCapabilities(
  tools: Array<Record<string, unknown>>,
  resources: Array<Record<string, unknown>>,
  prompts: Array<Record<string, unknown>>,
): boolean {
  return tools.length > 0 || resources.length > 0 || prompts.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
