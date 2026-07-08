import assert from "node:assert/strict";

import { parseCodexRuntimeStatus } from "./CodexRuntimeStatus";

function test(name: string, run: () => void): void {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("detects CC Switch local routing without exposing provider tokens", () => {
  const status = parseCodexRuntimeStatus(`
model_provider = "custom"
model = "claude-sonnet-4"
model_catalog_json = "cc-switch-model-catalog.json"

[model_providers.custom]
name = "CC Switch"
base_url = "http://127.0.0.1:15721/v1"
wire_api = "chat"
experimental_bearer_token = "secret-token"
`, "C:/Users/admin/.codex/config.toml");

  assert.equal(status.configPath, "C:/Users/admin/.codex/config.toml");
  assert.equal(status.modelProvider, "custom");
  assert.equal(status.providerName, "CC Switch");
  assert.equal(status.model, "claude-sonnet-4");
  assert.equal(status.baseUrl, "http://127.0.0.1:15721/v1");
  assert.equal(status.wireApi, "chat");
  assert.equal(status.modelCatalogJson, "cc-switch-model-catalog.json");
  assert.equal(status.hasProviderScopedToken, true);
  assert.equal(status.usesLocalRouting, true);
  assert.equal(status.looksLikeCcSwitchCustomProvider, true);
  assert.equal(JSON.stringify(status).includes("secret-token"), false);
});

test("recognizes direct third-party Responses endpoints as non-local routing", () => {
  const status = parseCodexRuntimeStatus(`
model_provider = "custom"
model = "gpt-5.5"

[model_providers.custom]
base_url = "https://anyrouter.top/v1"
wire_api = "responses"
experimental_bearer_token = "provider-token"
`, "C:/Users/admin/.codex/config.toml");

  assert.equal(status.modelProvider, "custom");
  assert.equal(status.model, "gpt-5.5");
  assert.equal(status.baseUrl, "https://anyrouter.top/v1");
  assert.equal(status.wireApi, "responses");
  assert.equal(status.hasProviderScopedToken, true);
  assert.equal(status.usesLocalRouting, false);
  assert.equal(status.looksLikeCcSwitchCustomProvider, true);
  assert.equal(JSON.stringify(status).includes("provider-token"), false);
});

test("falls back safely when the selected provider section is missing", () => {
  const status = parseCodexRuntimeStatus(`
model_provider = "custom"
model = "gpt-5.5"
`, "C:/Users/admin/.codex/config.toml");

  assert.equal(status.modelProvider, "custom");
  assert.equal(status.model, "gpt-5.5");
  assert.equal(status.providerName, null);
  assert.equal(status.baseUrl, null);
  assert.equal(status.wireApi, null);
  assert.equal(status.modelCatalogJson, null);
  assert.equal(status.hasProviderScopedToken, false);
  assert.equal(status.usesLocalRouting, false);
  assert.equal(status.looksLikeCcSwitchCustomProvider, true);
});
