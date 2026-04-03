export const DEFAULT_RUNTIME_IMAGE_EXAMPLE = 'Derived from platform version';
export const DEFAULT_RUNTIME_IMAGE_BOOTSTRAP_LABEL =
  'Bootstrap-managed (derived from platform version)';
export const RUNTIME_IMAGE_BOOTSTRAP_COPY =
  'Fresh stacks can use RUNTIME_IMAGE in .env as an explicit override. Otherwise released platform builds derive the matching runtime image from their own version on first boot. After that, change it here or through the API without editing .env again.';
export const ORCHESTRATOR_RUNTIME_IMAGE_BOOTSTRAP_COPY =
  'Fresh stacks can use RUNTIME_IMAGE in .env as an explicit override. Otherwise released platform builds derive the matching orchestrator runtime image from the platform version on first boot. After that, this pool setting becomes the source of truth until you change it here or through the API.';
