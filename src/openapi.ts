import { defineCapability } from "./define.js";
import type { Capability, CapabilityManifest, JsonSchema } from "./types.js";
import { slugify } from "./utils.js";

export type OpenApiDocument = Record<string, unknown> & { openapi?: string; info?: { title?: string; version?: string }; servers?: Array<{ url?: string }>; paths?: Record<string, Record<string, unknown>> };
export type OpenApiImportOptions = { namespace?: string; baseUrl?: string; fetch?: typeof fetch; headers?: Readonly<Record<string, string>> };
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

function dereferenceLocal(document: OpenApiDocument, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref !== "string" || !record.$ref.startsWith("#/")) return value;
  let current: unknown = document;
  for (const part of record.$ref.slice(2).split("/")) {
    if (!current || typeof current !== "object") return value;
    current = (current as Record<string, unknown>)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return current ?? value;
}

function jsonSchemaFromMedia(content: unknown): JsonSchema | undefined {
  if (!content || typeof content !== "object") return undefined;
  const media = content as Record<string, unknown>;
  const preferred = media["application/json"] ?? Object.entries(media).find(([key]) => key.endsWith("+json"))?.[1];
  if (!preferred || typeof preferred !== "object") return undefined;
  const schema = (preferred as Record<string, unknown>).schema;
  return schema && typeof schema === "object" && !Array.isArray(schema) ? schema as JsonSchema : undefined;
}

function operationInputSchema(document: OpenApiDocument, pathItem: Record<string, unknown>, operation: Record<string, unknown>): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
  for (const raw of parameters) {
    const parameter = dereferenceLocal(document, raw);
    if (!parameter || typeof parameter !== "object") continue;
    const p = parameter as Record<string, unknown>;
    if (typeof p.name !== "string" || typeof p.in !== "string") continue;
    const group = p.in === "path" ? "path" : p.in === "query" ? "query" : p.in === "header" ? "headers" : undefined;
    if (!group) continue;
    const groupSchema = (properties[group] ??= { type: "object", properties: {}, required: [] }) as Record<string, unknown>;
    const groupProperties = groupSchema.properties as Record<string, unknown>;
    groupProperties[p.name] = (p.schema && typeof p.schema === "object") ? p.schema : {};
    if (p.required === true || p.in === "path") {
      (groupSchema.required as string[]).push(p.name);
      if (!required.includes(group)) required.push(group);
    }
  }
  const requestBody = dereferenceLocal(document, operation.requestBody);
  if (requestBody && typeof requestBody === "object") {
    const body = requestBody as Record<string, unknown>;
    const bodySchema = jsonSchemaFromMedia(body.content);
    if (bodySchema) { properties.body = bodySchema; if (body.required === true) required.push("body"); }
  }
  return { type: "object", properties, ...(required.length ? { required: [...new Set(required)] } : {}) };
}

function operationOutputSchema(document: OpenApiDocument, operation: Record<string, unknown>): JsonSchema | undefined {
  if (!operation.responses || typeof operation.responses !== "object") return undefined;
  const responses = operation.responses as Record<string, unknown>;
  const key = Object.keys(responses).sort().find((code) => /^2\d\d$/.test(code)) ?? "default";
  const raw = dereferenceLocal(document, responses[key]);
  if (!raw || typeof raw !== "object") return undefined;
  return jsonSchemaFromMedia((raw as Record<string, unknown>).content);
}

function stringifyQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
    else params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function capabilitiesFromOpenApi(document: OpenApiDocument, options: OpenApiImportOptions = {}): Capability[] {
  if (typeof document.openapi !== "string" || !document.openapi.startsWith("3.1")) throw new TypeError("OpenAPI 3.1 document required");
  const namespace = slugify(options.namespace ?? document.info?.title ?? "openapi");
  const baseUrl = options.baseUrl ?? document.servers?.[0]?.url;
  if (!baseUrl) throw new TypeError("OpenAPI document must provide a server URL or options.baseUrl");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new TypeError("A fetch implementation is required");
  const capabilities: Capability[] = [];
  for (const [pathTemplate, rawPathItem] of Object.entries(document.paths ?? {})) {
    if (!rawPathItem || typeof rawPathItem !== "object") continue;
    const pathItem = rawPathItem as Record<string, unknown>;
    for (const method of METHODS) {
      const rawOperation = pathItem[method];
      if (!rawOperation || typeof rawOperation !== "object") continue;
      const operation = rawOperation as Record<string, unknown>;
      const operationId = typeof operation.operationId === "string" ? operation.operationId : `${method}-${pathTemplate}`;
      const id = `${namespace}/${slugify(operationId)}`;
      const input = operationInputSchema(document, pathItem, operation);
      const output = operationOutputSchema(document, operation);
      const manifest: CapabilityManifest = {
        specVersion: "0.1", id,
        version: document.info?.version && /^\d+\.\d+\.\d+/.test(document.info.version) ? document.info.version : "0.0.0",
        name: typeof operation.summary === "string" ? operation.summary : operationId,
        description: typeof operation.description === "string" ? operation.description : `${method.toUpperCase()} ${pathTemplate}`,
        input, ...(output ? { output } : {}), effects: ["network.connect"],
        behavior: { deterministic: false, idempotent: ["get", "head", "put", "delete"].includes(method), reversible: false },
        tags: ["openapi", method, ...((Array.isArray(operation.tags) ? operation.tags : []).filter((tag): tag is string => typeof tag === "string"))],
        metadata: { openapiOperationId: operationId, method: method.toUpperCase(), path: pathTemplate }
      };
      capabilities.push(defineCapability({
        manifest,
        plan(inputValue: any) { return { summary: `${method.toUpperCase()} ${pathTemplate}`, data: { path: inputValue?.path ?? {}, query: inputValue?.query ?? {} } }; },
        async execute(inputValue: any, context) {
          let path = pathTemplate;
          for (const [key, value] of Object.entries(inputValue?.path ?? {})) path = path.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
          const headers: Record<string, string> = { ...(options.headers ?? {}), ...(inputValue?.headers ?? {}) };
          let body: string | undefined;
          if (inputValue?.body !== undefined) { headers["content-type"] ??= "application/json"; body = headers["content-type"].includes("json") ? JSON.stringify(inputValue.body) : String(inputValue.body); }
          const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}${stringifyQuery(inputValue?.query)}`, { method: method.toUpperCase(), headers, ...(body !== undefined ? { body } : {}), signal: context.signal });
          const contentType = response.headers.get("content-type") ?? "";
          const value = contentType.includes("json") ? await response.json() : await response.text();
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
          return value;
        }
      }));
    }
  }
  return capabilities;
}
