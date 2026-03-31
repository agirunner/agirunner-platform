import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory).sort((left, right) => left.localeCompare(right));

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(absolutePath));
      continue;
    }
    if (entry.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }

  return files;
}

export function readApiSource() {
  const filePaths = [
    resolve(import.meta.dirname, './contracts.ts'),
    ...listTypeScriptFiles(resolve(import.meta.dirname, './contracts')),
    resolve(import.meta.dirname, './create-dashboard-api.ts'),
    resolve(import.meta.dirname, './create-dashboard-api.request.ts'),
    resolve(import.meta.dirname, './create-dashboard-api.search.ts'),
    ...listTypeScriptFiles(resolve(import.meta.dirname, './create-dashboard-api')),
  ];

  return filePaths.map((filePath) => readFileSync(filePath, 'utf8')).join('\n');
}

function readInterfaceDeclaration(source: string, interfaceName: string): string {
  const regex = new RegExp(`(?:export\\s+)?interface\\s+${interfaceName}\\b`, 'm');
  const match = regex.exec(source);
  if (!match) {
    throw new Error(`Interface ${interfaceName} not found`);
  }

  const start = match.index;
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) {
    throw new Error(`Interface ${interfaceName} opening brace not found`);
  }

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Interface ${interfaceName} end not found`);
}

export function readInterfaceBlock(source: string, interfaceName: string) {
  return readInterfaceDeclaration(source, interfaceName);
}

export function readExportBlock(source: string, name: string) {
  const interfaceRegex = new RegExp(`export\\s+interface\\s+${name}\\b`, 'm');
  if (interfaceRegex.test(source)) {
    return readInterfaceDeclaration(source, name);
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
