const API_KEY_LAST_USED_WRITE_INTERVAL_MS = 60_000;
const MAX_TRACKED_API_KEYS = 4_096;

const lastUsedWriteByKeyId = new Map<string, number>();

export function shouldPersistApiKeyLastUsed(keyId: string, now = Date.now()): boolean {
  const lastPersistedAt = lastUsedWriteByKeyId.get(keyId);
  if (lastPersistedAt !== undefined && now - lastPersistedAt < API_KEY_LAST_USED_WRITE_INTERVAL_MS) {
    return false;
  }

  if (lastUsedWriteByKeyId.size >= MAX_TRACKED_API_KEYS) {
    pruneOldestEntry();
  }

  lastUsedWriteByKeyId.set(keyId, now);
  return true;
}

export function clearPersistedApiKeyLastUsed(keyId: string): void {
  lastUsedWriteByKeyId.delete(keyId);
}

export function resetPersistedApiKeyLastUsedForTests(): void {
  lastUsedWriteByKeyId.clear();
}

function pruneOldestEntry(): void {
  const oldestEntry = lastUsedWriteByKeyId.entries().next().value;
  if (oldestEntry) {
    lastUsedWriteByKeyId.delete(oldestEntry[0]);
  }
}
