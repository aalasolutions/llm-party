import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { AppConfig } from "../types.js";

const VALID_PROVIDERS = ["claude", "codex", "copilot", "glm"] as const;
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

export async function initProjectFolder(cwd: string): Promise<void> {
  const projectHome = path.join(cwd, ".llm-party");
  const memoryDir = path.join(projectHome, "memory");
  const skillsDir = path.join(projectHome, "skills");

  await mkdir(memoryDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  const tasksFile = path.join(projectHome, "TASKS.md");
  try {
    await access(tasksFile);
  } catch {
    await writeFile(tasksFile, "# Tasks\n", "utf8");
  }

  const projectMd = path.join(memoryDir, "project.md");
  try {
    await access(projectMd);
  } catch {
    await writeFile(projectMd, "# Project Memory\n\n## Current State\n\nLast Updated:\nActive:\nBlockers:\nNext:\n\n---\n\n## Log\n", "utf8");
  }

  const decisionsMd = path.join(memoryDir, "decisions.md");
  try {
    await access(decisionsMd);
  } catch {
    await writeFile(decisionsMd, "# Decisions\n", "utf8");
  }
}

export async function initLlmPartyHome(appRoot: string): Promise<void> {
  await mkdir(LLM_PARTY_HOME, { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "sessions"), { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "network"), { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "agents"), { recursive: true });

  const projectsYml = path.join(LLM_PARTY_HOME, "network", "projects.yml");
  try {
    await access(projectsYml);
  } catch {
    await writeFile(projectsYml, "projects: []\n", "utf8");
  }

  const librariesYml = path.join(LLM_PARTY_HOME, "network", "libraries.yml");
  try {
    await access(librariesYml);
  } catch {
    await writeFile(librariesYml, "libraries: []\n", "utf8");
  }

  const globalConfig = path.join(LLM_PARTY_HOME, "config.json");
  try {
    await access(globalConfig);
  } catch {
    const bundledConfig = await readFile(path.join(appRoot, "configs", "default.json"), "utf8");
    await writeFile(globalConfig, bundledConfig, "utf8");
  }
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  validateConfig(parsed);
  return normalizeConfig(parsed as Record<string, unknown>);
}

export { LLM_PARTY_HOME };
