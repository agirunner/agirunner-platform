const MEMORY_ALLOCATION_PATTERN =
  /^\d+(?:\.\d+)?(?:b|k|m|g|t|p|e|kb|mb|gb|tb|pb|eb|ki|mi|gi|ti|pi|ei|kib|mib|gib|tib|pib|eib)?$/i;
const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const IMAGE_DIGEST_PATTERN = /^[A-Za-z][A-Za-z0-9_+.-]*:[A-Fa-f0-9]{32,}$/;
const IMAGE_HOST_PATTERN =
  /^(?:localhost|[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)(?::\d+)?$/;
const IMAGE_PATH_SEGMENT_PATTERN = /^[a-z0-9]+(?:(?:[._-]|__)[a-z0-9]+)*$/;

interface ValidationOptions {
  emptyValueHint?: string;
}

export function validateContainerImage(
  value: string,
  label: string,
  options: ValidationOptions = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/\s/.test(trimmed) || trimmed.includes('://') || !isValidContainerImageRef(trimmed)) {
    return `${label} must be a valid container image reference like image:tag or image@sha256:digest, such as ghcr.io/agirunner/runtime:v1.4.2.${buildHint(options.emptyValueHint)}`;
  }
  return null;
}

export function validateContainerCpu(
  value: string,
  label: string,
  options: ValidationOptions = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return `${label} must be a positive number such as 1 or 0.5.${buildHint(options.emptyValueHint)}`;
  }
  if (parsed <= 0) {
    return `${label} must be greater than 0.${buildHint(options.emptyValueHint)}`;
  }
  return null;
}

export function validateContainerMemory(
  value: string,
  label: string,
  options: ValidationOptions = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!MEMORY_ALLOCATION_PATTERN.test(trimmed)) {
    return `${label} must look like 512m, 2g, or 2Gi.${buildHint(options.emptyValueHint)}`;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return `${label} must be greater than 0.${buildHint(options.emptyValueHint)}`;
  }
  return null;
}

function buildHint(hint: string | undefined): string {
  return hint ? ` ${hint}` : '';
}

function isValidContainerImageRef(value: string): boolean {
  const [nameWithOptionalTag, digest] = splitOnce(value, '@');
  if (!nameWithOptionalTag || !isValidDigest(digest)) {
    return false;
  }

  const lastSlashIndex = nameWithOptionalTag.lastIndexOf('/');
  const lastColonIndex = nameWithOptionalTag.lastIndexOf(':');
  const hasTag = lastColonIndex > lastSlashIndex;
  const name = hasTag ? nameWithOptionalTag.slice(0, lastColonIndex) : nameWithOptionalTag;
  const tag = hasTag ? nameWithOptionalTag.slice(lastColonIndex + 1) : null;

  if (!name || (tag !== null && !IMAGE_TAG_PATTERN.test(tag))) {
    return false;
  }

  const segments = name.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return false;
  }
  const hasRegistryHost =
    segments.length > 1 &&
    (segments[0] === 'localhost' || segments[0].includes('.') || segments[0].includes(':'));
  const [host, pathSegments] = hasRegistryHost
    ? [segments[0], segments.slice(1)]
    : [null, segments];

  if (host && !IMAGE_HOST_PATTERN.test(host)) {
    return false;
  }
  return pathSegments.length > 0 && pathSegments.every((segment) => IMAGE_PATH_SEGMENT_PATTERN.test(segment));
}

function isValidDigest(value: string | null): boolean {
  return value === null || IMAGE_DIGEST_PATTERN.test(value);
}

function splitOnce(value: string, delimiter: '@'): [string, string | null] {
  const index = value.indexOf(delimiter);
  if (index === -1) {
    return [value, null];
  }
  if (value.indexOf(delimiter, index + 1) !== -1) {
    return ['', null];
  }
  return [value.slice(0, index), value.slice(index + 1)];
}
