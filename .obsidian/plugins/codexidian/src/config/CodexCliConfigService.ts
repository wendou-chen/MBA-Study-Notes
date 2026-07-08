import fs from "fs";
import path from "path";

import TOML from "@iarna/toml";
import { parseArgsStringToArgv } from "string-argv";

import { createCodexRuntimeStatus } from "./CodexRuntimeStatus";
import {
  type ConfigValueSource,
  type ResolvedCodexCliConfig,
  formatTokenWindow,
  normalizeContextWindowOverride,
  normalizeModelOverride,
} from "../types";

interface ResolveCliConfigOptions {
  codexCommand: string;
  modelOverride: string;
  contextWindowOverrideTokens: number | null;
}

interface CommandOverrides {
  profile: string | null;
  model: string | null;
  contextWindowTokens: number | null;
}

type TomlRecord = Record<string, unknown>;

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

export class CodexCliConfigService {
  private watchedConfigPath: string | null = null;
  private watchHandler: ((curr: fs.Stats, prev: fs.Stats) => void) | null = null;

  resolveConfigPath(): string {
    const codexHome = process.env.CODEX_HOME?.trim();
    if (codexHome) {
      return path.join(codexHome, "config.toml");
    }

    const homeDir = process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || "";
    if (!homeDir) {
      return path.join(".codex", "config.toml");
    }

    return path.join(homeDir, ".codex", "config.toml");
  }

  watchConfigFile(onChange: () => void): void {
    const nextPath = this.resolveConfigPath();
    if (this.watchedConfigPath === nextPath && this.watchHandler) {
      return;
    }

    this.unwatchConfigFile();

    const handler = (curr: fs.Stats, prev: fs.Stats): void => {
      if (
        curr.mtimeMs === prev.mtimeMs
        && curr.ctimeMs === prev.ctimeMs
        && curr.size === prev.size
      ) {
        return;
      }
      onChange();
    };

    fs.watchFile(nextPath, { interval: 1000 }, handler);
    this.watchedConfigPath = nextPath;
    this.watchHandler = handler;
  }

  unwatchConfigFile(): void {
    if (this.watchedConfigPath && this.watchHandler) {
      fs.unwatchFile(this.watchedConfigPath, this.watchHandler);
    }
    this.watchedConfigPath = null;
    this.watchHandler = null;
  }

  dispose(): void {
    this.unwatchConfigFile();
  }

  resolveEffectiveConfig(options: ResolveCliConfigOptions): ResolvedCodexCliConfig {
    const configPath = this.resolveConfigPath();
    const parsedCommand = this.parseCodexCommand(options.codexCommand);

    let config: TomlRecord = {};
    let warningMessage: string | null = null;

    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf8");
        config = TOML.parse(raw) as TomlRecord;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warningMessage = `Failed to parse Codex CLI config (${configPath}): ${message}`;
      }
    } else {
      warningMessage = `Codex CLI config not found: ${configPath}`;
    }

    const profileName = parsedCommand.profile;
    const profiles = this.getRecord(config.profiles);
    const profileConfig = profileName ? this.getRecord(profiles?.[profileName]) : null;
    if (profileName && !profileConfig) {
      warningMessage = `Codex CLI profile not found: ${profileName}`;
    }

    const rootModel = this.getOptionalString(config.model);
    const profileModel = this.getOptionalString(profileConfig?.model);
    const rootContextWindow = normalizeContextWindowOverride(config.model_context_window);
    const profileContextWindow = normalizeContextWindowOverride(profileConfig?.model_context_window);

    const modelOverride = normalizeModelOverride(options.modelOverride);
    const contextWindowOverride = normalizeContextWindowOverride(options.contextWindowOverrideTokens);

    const [model, modelSource] = this.pickValue<string>([
      [modelOverride || null, "override"],
      [parsedCommand.model, "command"],
      [profileModel, "profile"],
      [rootModel, "config"],
      ["", "default"],
    ]);

    const [contextWindowTokens, contextWindowSource] = this.pickValue<number>([
      [contextWindowOverride, "override"],
      [parsedCommand.contextWindowTokens, "command"],
      [profileContextWindow, "profile"],
      [rootContextWindow, "config"],
      [DEFAULT_CONTEXT_WINDOW_TOKENS, "default"],
    ]);

    return {
      configPath,
      profile: profileName,
      model,
      contextWindowTokens,
      modelSource,
      contextWindowSource,
      runtimeStatus: createCodexRuntimeStatus(config, configPath),
      lastLoadedAt: Date.now(),
      warningMessage,
    };
  }

  getLaunchConfigArgs(options: ResolveCliConfigOptions): string[] {
    const args: string[] = [];
    const modelOverride = normalizeModelOverride(options.modelOverride);
    const contextWindowOverride = normalizeContextWindowOverride(options.contextWindowOverrideTokens);

    if (modelOverride) {
      args.push("-c", `model=${JSON.stringify(modelOverride)}`);
    }

    if (contextWindowOverride !== null) {
      args.push("-c", `model_context_window=${contextWindowOverride}`);
    }

    return args;
  }

  describeResolvedValue(config: ResolvedCodexCliConfig, kind: "model" | "contextWindow"): string {
    if (kind === "model") {
      return `${config.model || "(default)"} [${this.describeSource(config.modelSource, config.profile)}]`;
    }
    return `${formatTokenWindow(config.contextWindowTokens)} [${this.describeSource(config.contextWindowSource, config.profile)}]`;
  }

  private describeSource(source: ConfigValueSource, profile: string | null): string {
    if (source === "profile" && profile) {
      return `CLI profile:${profile}`;
    }
    if (source === "override") {
      return "Override";
    }
    if (source === "command") {
      return "CLI command";
    }
    if (source === "config") {
      return "CLI config";
    }
    return "Default";
  }

  private parseCodexCommand(command: string): CommandOverrides {
    const tokens = parseArgsStringToArgv(command || "");
    const parsed: CommandOverrides = {
      profile: null,
      model: null,
      contextWindowTokens: null,
    };

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === "-p" || token === "--profile") {
        parsed.profile = this.getOptionalString(tokens[index + 1]) ?? parsed.profile;
        index += 1;
        continue;
      }
      if (token.startsWith("--profile=")) {
        parsed.profile = this.getOptionalString(token.slice("--profile=".length)) ?? parsed.profile;
        continue;
      }
      if (token.startsWith("-p=")) {
        parsed.profile = this.getOptionalString(token.slice(3)) ?? parsed.profile;
        continue;
      }

      if (token === "-m" || token === "--model") {
        parsed.model = normalizeModelOverride(tokens[index + 1]);
        index += 1;
        continue;
      }
      if (token.startsWith("--model=")) {
        parsed.model = normalizeModelOverride(token.slice("--model=".length));
        continue;
      }
      if (token.startsWith("-m=")) {
        parsed.model = normalizeModelOverride(token.slice(3));
        continue;
      }

      if (token === "-c" || token === "--config") {
        this.applyInlineConfigOverride(parsed, tokens[index + 1]);
        index += 1;
        continue;
      }
      if (token.startsWith("--config=")) {
        this.applyInlineConfigOverride(parsed, token.slice("--config=".length));
        continue;
      }
      if (token.startsWith("-c=")) {
        this.applyInlineConfigOverride(parsed, token.slice(3));
        continue;
      }
    }

    return parsed;
  }

  private applyInlineConfigOverride(parsed: CommandOverrides, rawExpression: unknown): void {
    const expression = this.getOptionalString(rawExpression);
    if (!expression) {
      return;
    }

    const separatorIndex = expression.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const key = expression.slice(0, separatorIndex).trim();
    const rawValue = expression.slice(separatorIndex + 1).trim();

    if (key === "model") {
      const parsedValue = this.parseTomlScalar<string>(rawValue);
      parsed.model = normalizeModelOverride(parsedValue ?? rawValue.replace(/^['"]|['"]$/g, ""));
      return;
    }

    if (key === "model_context_window") {
      const parsedValue = this.parseTomlScalar<number>(rawValue);
      parsed.contextWindowTokens = normalizeContextWindowOverride(parsedValue ?? rawValue);
    }
  }

  private parseTomlScalar<T>(rawValue: string): T | null {
    try {
      const parsed = TOML.parse(`value = ${rawValue}`) as { value?: T };
      return parsed.value ?? null;
    } catch {
      return null;
    }
  }

  private pickValue<T>(entries: Array<[T | null | undefined, ConfigValueSource]>): [T, ConfigValueSource] {
    for (const [value, source] of entries) {
      if (value !== null && value !== undefined && value !== "") {
        return [value as T, source];
      }
    }

    return [entries[entries.length - 1][0] as T, entries[entries.length - 1][1]];
  }

  private getRecord(value: unknown): TomlRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as TomlRecord;
  }

  private getOptionalString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
