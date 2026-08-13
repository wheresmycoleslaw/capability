import type { JsonSchema } from "./types.js";

export type SchemaValidationIssue = { path: string; message: string };

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    default: return typeof value === type;
  }
}

export function validateValue(schema: JsonSchema | undefined, value: unknown, path = "$" ): SchemaValidationIssue[] {
  if (!schema) return [];
  const issues: SchemaValidationIssue[] = [];
  const allowedTypes = typeof schema.type === "string"
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type.filter((v): v is string => typeof v === "string")
      : [];
  if (allowedTypes.length && !allowedTypes.some((type) => typeMatches(type, value))) {
    issues.push({ path, message: `expected ${allowedTypes.join(" or ")}` });
    return issues;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) issues.push({ path, message: "value is not in enum" });
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !Object.is(schema.const, value)) issues.push({ path, message: "value does not match const" });
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push({ path, message: `must have length >= ${schema.minLength}` });
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) issues.push({ path, message: `must have length <= ${schema.maxLength}` });
    if (typeof schema.pattern === "string" && !(new RegExp(schema.pattern).test(value))) issues.push({ path, message: `must match /${schema.pattern}/` });
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push({ path, message: `must be >= ${schema.minimum}` });
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push({ path, message: `must be <= ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push({ path, message: `must contain at least ${schema.minItems} items` });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push({ path, message: `must contain at most ${schema.maxItems} items` });
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      value.forEach((item, index) => issues.push(...validateValue(schema.items as JsonSchema, item, `${path}[${index}]`)));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required.filter((v): v is string => typeof v === "string") : [];
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(object, key)) issues.push({ path: `${path}.${key}`, message: "is required" });
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, JsonSchema> : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(object, key)) issues.push(...validateValue(propertySchema, object[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) if (!Object.prototype.hasOwnProperty.call(properties, key)) issues.push({ path: `${path}.${key}`, message: "additional property is not allowed" });
    }
  }
  return issues;
}
