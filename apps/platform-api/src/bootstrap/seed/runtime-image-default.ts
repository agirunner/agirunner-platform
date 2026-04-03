export const DEFAULT_RUNTIME_IMAGE = 'agirunner-runtime:local';
export const MANAGED_RELEASE_RUNTIME_IMAGE_REPOSITORY = 'ghcr.io/agirunner/agirunner-runtime';

const RELEASE_IMAGE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MANAGED_RUNTIME_IMAGE_ALIASES = new Set([
  `${MANAGED_RELEASE_RUNTIME_IMAGE_REPOSITORY}:latest`,
  `${MANAGED_RELEASE_RUNTIME_IMAGE_REPOSITORY}:local`,
  'agirunner-runtime:latest',
  'agirunner-runtime:local',
]);

export function resolveSeedRuntimeImage(
  runtimeImage?: string | null,
  platformImageVersion: string | null | undefined = process.env.AGIRUNNER_IMAGE_VERSION,
): string {
  const trimmedRuntimeImage = readTrimmedValue(runtimeImage);
  if (trimmedRuntimeImage) {
    return trimmedRuntimeImage;
  }
  return deriveManagedRuntimeImage(platformImageVersion);
}

export function deriveManagedRuntimeImage(
  platformImageVersion: string | null | undefined,
): string {
  const trimmedPlatformImageVersion = readTrimmedValue(platformImageVersion);
  if (!trimmedPlatformImageVersion || !isReleasedImageVersion(trimmedPlatformImageVersion)) {
    return DEFAULT_RUNTIME_IMAGE;
  }

  return `${MANAGED_RELEASE_RUNTIME_IMAGE_REPOSITORY}:${trimmedPlatformImageVersion}`;
}

export function isManagedRuntimeImageAlias(value?: string | null): boolean {
  const trimmedValue = readTrimmedValue(value);
  return trimmedValue ? MANAGED_RUNTIME_IMAGE_ALIASES.has(trimmedValue) : false;
}

function isReleasedImageVersion(value: string): boolean {
  return RELEASE_IMAGE_VERSION_PATTERN.test(value);
}

function readTrimmedValue(value?: string | null): string | null {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : null;
}
