import path from "path";

import TOML from "@iarna/toml";

type TomlRecord = Record<string, unknown>;

export interface CodexRuntimeStatus {
  configPath: string;
  modelProvider: string | null;
  model: string | null;
  providerName: string | null;
  baseUrl: string | null;
  wireApi: string | null;
  modelCatalogJson: string | null;
  hasProviderScopedToken: boolean;
  usesLocalRouting: boolean;
  looksLikeCcSwitchCustomProvider: boolean;
}

const TOKEN_KEYS = new Set([
  "api_key",
  "bearer_token",
  "experimental_bearer_token",
  "env_key",
]);

export function parseCodexRuntimeStatus(rawToml: string, configPath: string): CodexRuntimeStatus {
  const parsed = TOML.parse(rawToml) as TomlRecord;
  return createCodexRuntimeStatus(parsed, configPath);
}

export function createCodexRuntimeStatus(config: TomlRecord, configPath: string): CodexRuntimeStatus {
  const modelProvider = getOptionalString(config.model_provider);
  const providers = getRecord(config.model_providers);
  const providerConfig = modelProvider ? getRecord(providers?.[modelProvider]) : null;
  const providerName = getOptionalString(providerConfig?.name);
  const baseUrl = getOptionalString(providerConfig?.base_url);
  const wireApi = getOptionalString(providerConfig?.wire_api);
  const modelCatalogJson = getOptionalString(config.model_catalog_json)
    ?? getOptionalString(providerConfig?.model_catalog_json);

  const looksLikeCcSwitchCustomProvider =
    modelProvider === "custom"
    || providerName?.toLowerCase().includes("cc switch") === true
    || path.basename(modelCatalogJson ?? "").toLowerCase() === "cc-switch-model-catalog.json";

  return {
    configPath,
    modelProvider,
    model: getOptionalString(config.model),
    providerName,
    baseUrl,
    wireApi,
    modelCatalogJson,
    hasProviderScopedToken: providerConfig ? hasTokenLikeSetting(providerConfig) : false,
    usesLocalRouting: isLocalRoutingEndpoint(baseUrl),
    looksLikeCcSwitchCustomProvider,
  };
}

function hasTokenLikeSetting(config: TomlRecord): boolean {
  return Object.entries(config).some(([key, value]) =>
    TOKEN_KEYS.has(key)
    && typeof value === "string"
    && value.trim().length > 0);
}

function isLocalRoutingEndpoint(baseUrl: string | null): boolean {
  if (!baseUrl) {
    return false;
  }

  try {
    const url = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    const normalized = baseUrl.trim().toLowerCase();
    return normalized.startsWith("http://localhost")
      || normalized.startsWith("http://127.0.0.1")
      || normalized.startsWith("http://[::1]");
  }
}

function getRecord(value: unknown): TomlRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as TomlRecord;
}

function getOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
