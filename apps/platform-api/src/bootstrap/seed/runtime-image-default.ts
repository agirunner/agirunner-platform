export const DEFAULT_RUNTIME_IMAGE = 'agirunner-runtime:local';

export function resolveSeedRuntimeImage(runtimeImage?: string | null): string {
  const trimmedRuntimeImage = runtimeImage?.trim();
  return trimmedRuntimeImage && trimmedRuntimeImage.length > 0
    ? trimmedRuntimeImage
    : DEFAULT_RUNTIME_IMAGE;
}
