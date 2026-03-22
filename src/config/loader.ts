import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { PROVIDERS } from "./defaults.js";
import { AppConfig } from "../types.js";

const VALID_PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));
const LLM_PARTY_HOME = path.join(homedir(), ".llm-party");

function validateConfig(data: unknown): void {
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

  const seenNames = new Set<string>();

  for (let i = 0; i < cfg.agents.length; i++) {
    const agent = cfg.agents[i];

    if (!agent || typeof agent !== "object") {
      throw new Error(`Agent at index ${i} must be an object`);
    }

    if (typeof agent.name !== "string" || agent.name.trim() === "") {
      throw new Error(`Agent at index ${i} must have a non-empty 'name' string`);
    }

    const normalizedName = agent.name.trim().toLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new Error(`Duplicate agent name '${agent.name}' at index ${i}. Agent names must be unique.`);
    }
    seenNames.add(normalizedName);

    if (typeof agent.model !== "string" || agent.model.trim() === "") {
      throw new Error(`Agent '${agent.name}' must have a non-empty 'model' string`);
    }

    if (!VALID_PROVIDER_IDS.has(agent.provider)) {
      throw new Error(
        `Agent '${agent.name}' has invalid provider '${agent.provider}'. Valid: ${Array.from(VALID_PROVIDER_IDS).join(", ")}`
      );
    }

    if (agent.prompts !== undefined) {
      const isArray = Array.isArray(agent.prompts) && (agent.prompts as unknown[]).every((p) => typeof p === "string");
      if (!isArray) {
        throw new Error(`Agent '${agent.name}' prompts must be a string array`);
      }
    }
  }
}

function normalizeConfig(data: Record<string, unknown>): AppConfig {
  const agents = data.agents as Record<string, unknown>[];

  for (const agent of agents) {
    if (typeof agent.executablePath === "string" && agent.executablePath.startsWith("~/")) {
      agent.executablePath = homedir() + agent.executablePath.slice(1);
    }
  }

  if (!data.humanName || (typeof data.humanName === "string" && data.humanName.trim() === "")) {
    data.humanName = userInfo().username || "USER";
  }

  return data as unknown as AppConfig;
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
  const bundledBase = path.join(appRoot, "prompts", "base.md");
  return await readFile(bundledBase, "utf8");
}

export async function resolveArtifactsPrompt(appRoot: string): Promise<string> {
  const bundledArtifacts = path.join(appRoot, "prompts", "artifacts.md");
  return await readFile(bundledArtifacts, "utf8");
}

async function ensureFile(filePath: string, defaultContent: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, defaultContent, "utf8");
  }
}

export async function initProjectFolder(cwd: string): Promise<void> {
  const projectHome = path.join(cwd, ".llm-party");
  const memoryDir = path.join(projectHome, "memory");
  const skillsDir = path.join(projectHome, "skills");

  await mkdir(memoryDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  await ensureFile(path.join(projectHome, "TASKS.md"), "# Tasks\n");
  await ensureFile(path.join(memoryDir, "project.md"), "# Project Memory\n\n## Current State\n\nLast Updated:\nActive:\nBlockers:\nNext:\n\n---\n\n## Log\n");
  await ensureFile(path.join(memoryDir, "decisions.md"), "# Decisions\n");
}

export async function initLlmPartyHome(appRoot: string): Promise<void> {
  await mkdir(LLM_PARTY_HOME, { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "sessions"), { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "network"), { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "agents"), { recursive: true });

  await ensureFile(path.join(LLM_PARTY_HOME, "network", "projects.yml"), "projects: []\n");
  await ensureFile(path.join(LLM_PARTY_HOME, "network", "libraries.yml"), "libraries: []\n");

}

export async function configExists(): Promise<boolean> {
  try {
    await access(path.join(LLM_PARTY_HOME, "config.json"));
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  validateConfig(parsed);
  return normalizeConfig(parsed as Record<string, unknown>);
}

export { LLM_PARTY_HOME };
