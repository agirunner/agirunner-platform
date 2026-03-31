import { readString } from './shared.js';

export function buildHumanizedShellExecHeadline(command: string | null): string | null {
  const normalized = normalizeShellCommand(command);
  if (!normalized || isLowValueShellCommand(normalized)) {
    return null;
  }
  if (looksLikePythonInstallCommand(normalized)) {
    return 'Installing Python 3 in the task environment.';
  }
  if (looksLikeVerificationScriptCommand(normalized)) {
    return 'Running the verification script.';
  }
  if (looksLikeRepositoryScanCommand(normalized)) {
    return 'Inspecting the repository files.';
  }
  return null;
}

export function isLowValueShellCommand(command: string | null): boolean {
  const normalized = normalizeShellCommand(command);
  if (!normalized) {
    return false;
  }
  const segments = splitShellCommandSegments(normalized);
  return segments.length > 0 && segments.every((segment) =>
    isLowValueShellVersionProbe(segment) || isLowValueShellSuccessMarker(segment),
  );
}

function normalizeShellCommand(command: string | null): string | null {
  const parsed = readString(command);
  return parsed ? parsed.replace(/\s+/g, ' ').trim() : null;
}

function splitShellCommandSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|;|\|\|)\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function stripShellRedirections(segment: string): string {
  return segment
    .replace(/\s+\d?>\/[^ ]+/g, '')
    .replace(/\s+\d?>&\d+/g, '')
    .replace(/\s+2>&1/g, '')
    .trim();
}

function isLowValueShellVersionProbe(segment: string): boolean {
  return /^(bash|python3?|node|npm|pnpm|git)\s+--version\b/i.test(stripShellRedirections(segment));
}

function isLowValueShellSuccessMarker(segment: string): boolean {
  return /^printf\s+['"][a-z0-9_\\n -]+['"]$/i.test(stripShellRedirections(segment));
}

function looksLikePythonInstallCommand(command: string): boolean {
  return /\bapt-get\b.*\binstall\b.*\bpython3\b/i.test(command);
}

function looksLikeVerificationScriptCommand(command: string): boolean {
  return /(^|[;&|]\s*)\.?\/?scripts\/verify\.sh\b/i.test(command);
}

function looksLikeRepositoryScanCommand(command: string): boolean {
  return /\bfind\.?\s+-maxdepth\b/i.test(command) || /\bfind\s+\.\s+-maxdepth\b/i.test(command);
}
