export const DEFAULT_RUNTIME_IMAGE_EXAMPLE = 'agirunner-runtime:local';
export const DEFAULT_RUNTIME_IMAGE_BOOTSTRAP_LABEL =
  `Bootstrap default (${DEFAULT_RUNTIME_IMAGE_EXAMPLE})`;
export const RUNTIME_IMAGE_BOOTSTRAP_COPY =
  'Fresh stacks seed this from RUNTIME_IMAGE in .env. After that, change it here or through the API without editing .env again.';
export const ORCHESTRATOR_RUNTIME_IMAGE_BOOTSTRAP_COPY =
  'Fresh stacks seed the initial image family from RUNTIME_IMAGE in .env. After that, this pool setting is the source of truth until you change it again here or through the API.';
