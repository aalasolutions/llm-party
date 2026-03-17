import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { AppConfig } from "../types.js";

const VALID_PROVIDERS = ["claude", "codex", "copilot", "glm"] as const;

function validateConfig(data: unknown): AppConfig {
  if (!data || typeof data !== "object") {
    throw new Error("Config must be an object");
  }

  const cfg = data as Record<string, unknown>;

  if (!Array.isArray(cfg.agents)) {
    throw new Error("Config must have 'agents' array");
  }

  if (cfg.agents.length === 0) {
    throw new Error("Config 'agents' array cannot be empty");
  }

  for (let i = 0; i < cfg.agents.length; i++) {
    const agent = cfg.agents[i];

    if (!agent || typeof agent !== "object") {
      throw new Error(`Agent at index ${i} must be an object`);
    }

    if (typeof agent.name !== "string" || agent.name.trim() === "") {
      throw new Error(`Agent at index ${i} must have a non-empty 'name' string`);
    }

    if (typeof agent.model !== "string" || agent.model.trim() === "") {
      throw new Error(`Agent '${agent.name}' must have a non-empty 'model' string`);
    }

    if (!VALID_PROVIDERS.includes(agent.provider)) {
      throw new Error(
        `Agent '${agent.name}' has invalid provider '${agent.provider}'. Valid: ${VALID_PROVIDERS.join(", ")}`
      );
    }

    if (agent.systemPrompt !== undefined) {
      const isString = typeof agent.systemPrompt === "string";
      const isArray = Array.isArray(agent.systemPrompt) && (agent.systemPrompt as unknown[]).every((p) => typeof p === "string");

      if (!isString && !isArray) {
        throw new Error(`Agent '${agent.name}' systemPrompt must be a string or string array`);
      }
    }

  }

  for (const agent of cfg.agents as Record<string, unknown>[]) {
    if (typeof agent.executablePath === "string" && agent.executablePath.startsWith("~/")) {
      agent.executablePath = homedir() + agent.executablePath.slice(1);
    }
  }

  return cfg as unknown as AppConfig;
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  return validateConfig(parsed);
}
