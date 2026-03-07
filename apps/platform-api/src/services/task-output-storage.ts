import path from 'node:path';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { OutputStateDeclaration } from '../orchestration/workflow-engine.js';
import { ValidationError } from '../errors/domain-errors.js';
import type { ArtifactService } from './artifact-service.js';

interface StoredArtifactReference {
  id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
}

interface OutputReferenceEnvelope {
  type: 'artifact' | 'git' | 'diff';
  location: string;
  media_type: string;
  size_bytes: number;
  summary?: string;
}

export interface StoredTaskOutputResult {
  output: unknown;
  gitInfo?: Record<string, unknown>;
  cleanupArtifactIds: string[];
}

export async function applyOutputStateDeclarations(
  artifactService: Pick<ArtifactService, 'uploadTaskArtifact'>,
  identity: ApiKeyIdentity,
  task: Record<string, unknown>,
  output: unknown,
  gitInfo: Record<string, unknown> | undefined,
): Promise<StoredTaskOutputResult> {
  const declarations = readOutputStateDeclarations(task);
  if (!declarations) {
    return {
      output,
      gitInfo,
      cleanupArtifactIds: [],
    };
  }

  const storedOutput = {
    ...asRecord(output, 'Task output must be an object when output_state is declared'),
  };
  let storedGitInfo = gitInfo ? { ...gitInfo } : undefined;
  const cleanupArtifactIds: string[] = [];

  for (const [field, declaration] of Object.entries(declarations)) {
    if (!(field in storedOutput)) {
      continue;
    }

    const value = storedOutput[field];
    if (declaration.mode === 'inline') {
      continue;
    }

    if (declaration.mode === 'artifact') {
      const artifact = await uploadDeclaredArtifact(
        artifactService,
        identity,
        task.id as string,
        field,
        value,
        declaration,
      );
      cleanupArtifactIds.push(artifact.id);
      storedOutput[field] = buildReferenceEnvelope({
        type: 'artifact',
        location: artifact.logical_path,
        mediaType: artifact.content_type,
        sizeBytes: artifact.size_bytes,
        summary: declaration.summary,
      });
      continue;
    }

    if (declaration.mode === 'git') {
      if (!storedGitInfo || !hasGitLocation(storedGitInfo)) {
        throw new ValidationError(
          `Task output field '${field}' is declared as git-backed but git_info does not describe a branch or commit`,
        );
      }
      storedOutput[field] = buildReferenceEnvelope({
        type: 'git',
        location: gitLocation(storedGitInfo),
        mediaType: declaration.media_type ?? 'application/json',
        sizeBytes: Buffer.byteLength(JSON.stringify(value)),
        summary: declaration.summary,
      });
      ensureNestedRecord(storedGitInfo, 'declared_outputs')[field] = value;
      continue;
    }

    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationError(
        `Task output field '${field}' is declared as diff-backed but is not a diff string`,
      );
    }
    storedOutput[field] = buildReferenceEnvelope({
      type: 'diff',
      location: `diff:${task.id as string}/${field}`,
      mediaType: declaration.media_type ?? 'text/x-diff',
      sizeBytes: Buffer.byteLength(value),
      summary: declaration.summary,
    });
    const writableGitInfo = storedGitInfo ?? {};
    ensureNestedRecord(writableGitInfo, 'declared_diffs')[field] = value;
    storedGitInfo = writableGitInfo;
  }

  return {
    output: storedOutput,
    gitInfo: storedGitInfo,
    cleanupArtifactIds,
  };
}

function readOutputStateDeclarations(
  task: Record<string, unknown>,
): Record<string, OutputStateDeclaration> | undefined {
  const metadata = asRecord(task.metadata ?? {}, 'Task metadata must be an object');
  const outputState = metadata.output_state;
  if (!outputState || typeof outputState !== 'object' || Array.isArray(outputState)) {
    return undefined;
  }
  return outputState as Record<string, OutputStateDeclaration>;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message);
  }
  return value as Record<string, unknown>;
}

async function uploadDeclaredArtifact(
  artifactService: Pick<ArtifactService, 'uploadTaskArtifact'>,
  identity: ApiKeyIdentity,
  taskId: string,
  field: string,
  value: unknown,
  declaration: OutputStateDeclaration,
): Promise<StoredArtifactReference> {
  const payload = serializeArtifactPayload(field, value, declaration);
  const artifact = await artifactService.uploadTaskArtifact(identity, taskId, {
    path: declaration.path ?? defaultArtifactPath(field, payload.extension),
    contentBase64: payload.data.toString('base64'),
    contentType: payload.mediaType,
    metadata: {
      state_declared_field: field,
      storage_mode: 'artifact',
    },
  });

  return {
    id: artifact.id,
    logical_path: artifact.logical_path,
    content_type: artifact.content_type,
    size_bytes: artifact.size_bytes,
  };
}

function serializeArtifactPayload(
  field: string,
  value: unknown,
  declaration: OutputStateDeclaration,
): { data: Buffer; mediaType: string; extension: string } {
  if (typeof value === 'string') {
    return {
      data: Buffer.from(value, 'utf8'),
      mediaType: declaration.media_type ?? 'text/plain; charset=utf-8',
      extension: declaration.media_type?.includes('json') ? 'json' : 'txt',
    };
  }

  try {
    const serialized = JSON.stringify(value);
    return {
      data: Buffer.from(serialized, 'utf8'),
      mediaType: declaration.media_type ?? 'application/json',
      extension: 'json',
    };
  } catch {
    throw new ValidationError(
      `Task output field '${field}' could not be serialized for artifact storage`,
    );
  }
}

function defaultArtifactPath(field: string, extension: string): string {
  const safeField = field.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return path.posix.join('state', `${safeField}.${extension}`);
}

function buildReferenceEnvelope(input: {
  type: 'artifact' | 'git' | 'diff';
  location: string;
  mediaType: string;
  sizeBytes: number;
  summary?: string;
}): OutputReferenceEnvelope {
  return {
    type: input.type,
    location: input.location,
    media_type: input.mediaType,
    size_bytes: input.sizeBytes,
    ...(input.summary ? { summary: input.summary } : {}),
  };
}

function hasGitLocation(gitInfo: Record<string, unknown>): boolean {
  return typeof gitInfo.commit_hash === 'string' || typeof gitInfo.branch === 'string';
}

function gitLocation(gitInfo: Record<string, unknown>): string {
  if (typeof gitInfo.commit_hash === 'string' && gitInfo.commit_hash.length > 0) {
    return `git:commit:${gitInfo.commit_hash}`;
  }
  return `git:branch:${String(gitInfo.branch)}`;
}

function ensureNestedRecord(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = target[key];
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  target[key] = created;
  return created;
}
