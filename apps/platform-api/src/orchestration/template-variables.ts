import { ConflictError, SchemaValidationFailedError, ValidationError } from '../errors/domain-errors.js';

export interface TemplateVariableDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required?: boolean;
  default?: unknown;
  description?: string;
}

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SchemaValidationFailedError(message);
  }
}

export function coerceVariableValue(name: string, type: TemplateVariableDefinition['type'], value: unknown): unknown {
  if (typeof value === type || type === 'json') {
    return value;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`Template variable '${name}' must be of type ${type}`);
  }
  switch (type) {
    case 'number': {
      const n = Number(value);
      if (isNaN(n)) {
        throw new ValidationError(`Template variable '${name}' must be a valid number, got '${value}'`);
      }
      return n;
    }
    case 'boolean': {
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new ValidationError(`Template variable '${name}' must be 'true' or 'false', got '${value}'`);
    }
    default:
      return value;
  }
}

export function assertVariableType(name: string, type: TemplateVariableDefinition['type'], value: unknown): void {
  if (type === 'json') {
    return;
  }

  if (typeof value !== type) {
    throw new ValidationError(`Template variable '${name}' must be of type ${type}`);
  }
}

export function parseTemplateVariables(value: unknown): TemplateVariableDefinition[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new SchemaValidationFailedError('Template schema field variables must be an array');
  }

  const names = new Set<string>();
  return value.map((raw, index) => {
    assertObject(raw, `Variable at index ${index} must be an object`);
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      throw new SchemaValidationFailedError(`Variable at index ${index} is missing required field 'name'`);
    }
    if (names.has(raw.name)) {
      throw new ConflictError(`Duplicate variable name '${raw.name}' in template schema`);
    }
    names.add(raw.name);

    const type = raw.type;
    if (!['string', 'number', 'boolean', 'json'].includes(String(type))) {
      throw new SchemaValidationFailedError(`Variable '${raw.name}' has invalid type '${String(type)}'`);
    }

    const definition: TemplateVariableDefinition = {
      name: raw.name,
      type: type as TemplateVariableDefinition['type'],
      required: raw.required !== false,
      default: raw.default,
      description: typeof raw.description === 'string' ? raw.description : undefined,
    };

    if (definition.default !== undefined) {
      assertVariableType(definition.name, definition.type, definition.default);
    }

    return definition;
  });
}

export function resolveTemplateVariables(
  variables: TemplateVariableDefinition[] | undefined,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const provided = overrides ?? {};

  for (const variable of variables ?? []) {
    const hasProvided = Object.prototype.hasOwnProperty.call(provided, variable.name);
    const value = hasProvided ? provided[variable.name] : variable.default;

    if (value === undefined && variable.required !== false) {
      throw new SchemaValidationFailedError(`Missing required template variable '${variable.name}'`);
    }

    if (value !== undefined) {
      const coerced = coerceVariableValue(variable.name, variable.type, value);
      result[variable.name] = coerced;
    }
  }

  for (const [key, value] of Object.entries(provided)) {
    if (!(variables ?? []).some((variable) => variable.name === key)) {
      result[key] = value;
    }
  }

  return result;
}

export function substituteTemplateVariables<T>(template: T, parameters: Record<string, unknown>): T {
  if (typeof template === 'string') {
    return template.replace(/\$\{(\w+)\}|\{\{\s*(\w+)\s*\}\}/g, (match, dollarName: string, braceName: string) => {
      const name = dollarName || braceName;
      return Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match;
    }) as T;
  }

  if (Array.isArray(template)) {
    return template.map((value) => substituteTemplateVariables(value, parameters)) as T;
  }

  if (template && typeof template === 'object') {
    const entries = Object.entries(template as Record<string, unknown>);
    return Object.fromEntries(entries.map(([key, value]) => [key, substituteTemplateVariables(value, parameters)])) as T;
  }

  return template;
}
