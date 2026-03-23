import { listSafetynetEntries } from './registry.js';

export function serializeSafetynetCatalog(): string {
  return JSON.stringify(listSafetynetEntries(), null, 2);
}
