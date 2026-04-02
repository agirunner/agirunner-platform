import { Buffer } from 'node:buffer';

import { writePlatformArtifactObject } from './platform-artifacts.js';

export function writeSeededArtifactObject(storageKey: string, payload: Buffer, contentType: string): void {
  writePlatformArtifactObject(storageKey, payload, contentType);
}
