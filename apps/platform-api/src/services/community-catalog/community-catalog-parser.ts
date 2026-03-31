import { load } from 'js-yaml';

export function parseYamlDocument<T>(text: string, context: string): T {
  const parsed = load(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid YAML document for ${context}`);
  }
  return parsed as T;
}

export function parseSkillMarkdown(text: string): {
  name: string;
  description: string;
  body: string;
} {
  const trimmed = text.trim();
  if (!trimmed.startsWith('---\n')) {
    throw new Error('SKILL.md is missing YAML frontmatter');
  }

  const endIndex = trimmed.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    throw new Error('SKILL.md frontmatter is not closed');
  }

  const frontmatter = trimmed.slice(4, endIndex);
  const body = trimmed.slice(endIndex + 5).trim();
  const parsed = parseYamlDocument<{ name?: string; description?: string }>(
    frontmatter,
    'SKILL.md frontmatter',
  );

  if (!parsed.name?.trim()) {
    throw new Error('SKILL.md frontmatter is missing name');
  }
  if (!parsed.description?.trim()) {
    throw new Error('SKILL.md frontmatter is missing description');
  }

  return {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    body,
  };
}
