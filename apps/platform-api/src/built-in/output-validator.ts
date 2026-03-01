/**
 * Output Schema Validator — FR-748
 *
 * When a task specifies an output schema (JSON Schema subset), the built-in
 * worker validates the agent's output against it before marking the task
 * complete. If validation fails, the task is rejected for rework.
 *
 * Supported schema keywords (JSON Schema draft-07 subset):
 *   type, required, properties, items, minLength, maxLength,
 *   minimum, maximum, enum, additionalProperties
 */

export interface SchemaValidationResult {
  valid: boolean;
  /** Human-readable description of the first validation failure, if any. */
  error?: string;
}

export type OutputSchema = Record<string, unknown>;

/**
 * Validates `output` against the provided JSON Schema subset.
 *
 * Returns `{ valid: true }` when no schema is provided (schema is optional).
 * Returns `{ valid: false, error }` when validation fails.
 */
export function validateOutputSchema(
  output: unknown,
  schema: OutputSchema | undefined,
): SchemaValidationResult {
  if (schema === undefined || schema === null) {
    return { valid: true };
  }

  return validateValue(output, schema, '$');
}

// ---------------------------------------------------------------------------
// Internal recursive validator
// ---------------------------------------------------------------------------

function validateValue(
  value: unknown,
  schema: OutputSchema,
  path: string,
): SchemaValidationResult {
  // type check
  const schemaType = schema['type'];
  if (typeof schemaType === 'string') {
    const typeResult = checkType(value, schemaType, path);
    if (!typeResult.valid) return typeResult;
  }

  // enum check
  const schemaEnum = schema['enum'];
  if (Array.isArray(schemaEnum)) {
    if (!schemaEnum.includes(value)) {
      return fail(`${path} must be one of [${schemaEnum.join(', ')}], got ${JSON.stringify(value)}`);
    }
  }

  // object-specific checks
  if (schemaType === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // required fields
    const requiredFields = schema['required'];
    if (Array.isArray(requiredFields)) {
      for (const field of requiredFields) {
        if (typeof field === 'string' && !(field in obj)) {
          return fail(`${path} is missing required field "${field}"`);
        }
      }
    }

    // properties
    const properties = schema['properties'];
    if (typeof properties === 'object' && properties !== null) {
      const propSchemas = properties as Record<string, OutputSchema>;
      for (const [key, propSchema] of Object.entries(propSchemas)) {
        if (key in obj) {
          const propResult = validateValue(obj[key], propSchema, `${path}.${key}`);
          if (!propResult.valid) return propResult;
        }
      }
    }

    // additionalProperties: false
    const additionalProperties = schema['additionalProperties'];
    if (additionalProperties === false && typeof properties === 'object' && properties !== null) {
      const allowedKeys = new Set(Object.keys(properties as object));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          return fail(`${path} has unexpected additional property "${key}"`);
        }
      }
    }
  }

  // array-specific checks
  if (schemaType === 'array' && Array.isArray(value)) {
    const itemSchema = schema['items'];
    if (typeof itemSchema === 'object' && itemSchema !== null) {
      for (let i = 0; i < value.length; i++) {
        const itemResult = validateValue(value[i], itemSchema as OutputSchema, `${path}[${i}]`);
        if (!itemResult.valid) return itemResult;
      }
    }
  }

  // string-specific checks
  if (schemaType === 'string' && typeof value === 'string') {
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && value.length < minLength) {
      return fail(`${path} must have at least ${minLength} characters`);
    }
    const maxLength = schema['maxLength'];
    if (typeof maxLength === 'number' && value.length > maxLength) {
      return fail(`${path} must have at most ${maxLength} characters`);
    }
  }

  // number-specific checks
  if ((schemaType === 'number' || schemaType === 'integer') && typeof value === 'number') {
    const minimum = schema['minimum'];
    if (typeof minimum === 'number' && value < minimum) {
      return fail(`${path} must be >= ${minimum}`);
    }
    const maximum = schema['maximum'];
    if (typeof maximum === 'number' && value > maximum) {
      return fail(`${path} must be <= ${maximum}`);
    }
  }

  return { valid: true };
}

function checkType(value: unknown, expectedType: string, path: string): SchemaValidationResult {
  const actualType = toJsonSchemaType(value);
  if (expectedType === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return fail(`${path} must be an integer, got ${actualType}`);
    }
    return { valid: true };
  }
  if (actualType !== expectedType) {
    return fail(`${path} must be of type "${expectedType}", got "${actualType}"`);
  }
  return { valid: true };
}

function toJsonSchemaType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function fail(error: string): SchemaValidationResult {
  return { valid: false, error };
}
