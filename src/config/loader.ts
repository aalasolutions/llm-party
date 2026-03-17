import { readFile, access, mkdir, copyFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { AppConfig } from "../types.js";

const VALID_PROVIDERS = ["claude", "codex", "copilot", "glm"] as const;
const LLM_PARTY_HOME = path.join(homedir(), ".llm-party");

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

    if (agent.prompts !== undefined) {
      const isArray = Array.isArray(agent.prompts) && (agent.prompts as unknown[]).every((p) => typeof p === "string");
      if (!isArray) {
        throw new Error(`Agent '${agent.name}' prompts must be a string array`);
      }
    }
  }

  for (const agent of cfg.agents as Record<string, unknown>[]) {
    if (typeof agent.executablePath === "string" && agent.executablePath.startsWith("~/")) {
      agent.executablePath = homedir() + agent.executablePath.slice(1);
    }
  }

  if (!cfg.humanName || (typeof cfg.humanName === "string" && cfg.humanName.trim() === "")) {
    cfg.humanName = userInfo().username || "USER";
  }

  return cfg as unknown as AppConfig;
}

export async function resolveConfigPath(appRoot: string): Promise<string> {
  if (process.env.LLM_PARTY_CONFIG) {
    return path.resolve(process.env.LLM_PARTY_CONFIG);
  }

  const globalConfig = path.join(LLM_PARTY_HOME, "config.json");
  try {
    await access(globalConfig);
    return globalConfig;
  } catch {
    // fall through to package default
  }

  return path.join(appRoot, "configs", "default.json");
}

export async function resolveBasePrompt(appRoot: string): Promise<string> {
  const globalBase = path.join(LLM_PARTY_HOME, "base.md");
  try {
    await access(globalBase);
    return await readFile(globalBase, "utf8");
  } catch {
    // fall through to bundled
  }

  const bundledBase = path.join(appRoot, "prompts", "base.md");
  return await readFile(bundledBase, "utf8");
}

export async function initLlmPartyHome(appRoot: string): Promise<void> {
  await mkdir(LLM_PARTY_HOME, { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "sessions"), { recursive: true });

  const globalBase = path.join(LLM_PARTY_HOME, "base.md");
  try {
    await access(globalBase);
  } catch {
    const bundledBase = path.join(appRoot, "prompts", "base.md");
    await copyFile(bundledBase, globalBase);
  }

  const globalConfig = path.join(LLM_PARTY_HOME, "config.json");
  try {
    await access(globalConfig);
  } catch {
    const username = userInfo().username || "USER";
    const defaultConfig = {
      humanName: username,
      agents: [
        {
          name: "Claude",
          tag: "claude",
          provider: "claude",
          model: "sonnet"
        }
      ]
    };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(globalConfig, JSON.stringify(defaultConfig, null, 2) + "\n", "utf8");
  }

  console.log(`Initialized ~/.llm-party/`);
  console.log(`  config: ${globalConfig}`);
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return validateConfig(parsed);
}

export { LLM_PARTY_HOME };
