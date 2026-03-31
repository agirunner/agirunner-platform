import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readApiSource() {
  const contractsSource = readFileSync(resolve(import.meta.dirname, './contracts.ts'), 'utf8');
  const implementationSource = readFileSync(
    resolve(import.meta.dirname, './create-dashboard-api.ts'),
    'utf8',
  );
  return `${contractsSource}\n${implementationSource}`;
}

export function readInterfaceBlock(source: string, interfaceName: string) {
  const start =
    source.indexOf(`export interface ${interfaceName} {`) >= 0
      ? source.indexOf(`export interface ${interfaceName} {`)
      : source.indexOf(`interface ${interfaceName} {`);
  if (start < 0) {
    throw new Error(`Interface ${interfaceName} not found`);
  }
  const end = source.indexOf('\n}\n', start);
  if (end < 0) {
    throw new Error(`Interface ${interfaceName} end not found`);
  }
  return source.slice(start, end);
}

export function readExportBlock(source: string, name: string) {
  const interfaceStart = source.indexOf(`export interface ${name} {`);
  if (interfaceStart >= 0) {
    const end = source.indexOf('\n}\n', interfaceStart);
    if (end < 0) {
      throw new Error(`Interface ${name} end not found`);
    }
    return source.slice(interfaceStart, end);
  }

  const typeStart = source.indexOf(`export type ${name} =`);
  if (typeStart < 0) {
    throw new Error(`Export ${name} not found`);
  }
  let depth = 0;
  let seenEquals = false;
  for (let index = typeStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '=') {
      seenEquals = true;
    }
    if (!seenEquals) {
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === ';' && depth === 0) {
      return source.slice(typeStart, index);
    }
  }
  throw new Error(`Type ${name} end not found`);
}
