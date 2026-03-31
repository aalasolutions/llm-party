import { readFile, readdir, writeFile, access, mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { PROVIDERS } from "./defaults.js";
import { AppConfig } from "../types.js";

const VALID_PROVIDER_IDS = new Set([...PROVIDERS.map((p) => p.id), "custom"]);
const LLM_PARTY_HOME = path.join(homedir(), ".llm-party");

const MIND_MAP_INDEX = `# Living Memory Neural Network

This is the shared brain between all agents. Read this file FIRST on every boot.

## How to use this index

1. Read this file to know what exists
2. Load entries relevant to your current task
3. Skip entries that do not apply to what you are about to do
4. When you write a new entry, update this index with a one-liner

## Entries

<!-- Agents: add new entries below. One line per entry. Format: - [[filename]] - one-line summary -->
`;

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

    if (typeof agent.tag !== "string" || agent.tag.trim() === "") {
      throw new Error(`Agent '${agent.name}' must have a non-empty 'tag' string. Tags are used for @tag routing and cannot contain spaces.`);
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(agent.tag.trim())) {
      throw new Error(`Agent '${agent.name}' tag '${agent.tag}' contains invalid characters. Use only letters, numbers, hyphens, and underscores.`);
    }

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

    if (agent.preloadSkills !== undefined) {
      const isArray = Array.isArray(agent.preloadSkills) && (agent.preloadSkills as unknown[]).every((p) => typeof p === "string");
      if (!isArray) {
        throw new Error(`Agent '${agent.name}' preloadSkills must be a string array`);
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

export async function resolveObsidianPrompt(appRoot: string): Promise<string> {
  const bundledObsidian = path.join(appRoot, "prompts", "obsidian.md");
  return await readFile(bundledObsidian, "utf8");
}

export interface DiscoveredSkill {
  name: string;
  path: string;
}

export async function discoverSkills(): Promise<Map<string, DiscoveredSkill>> {
  const skills = new Map<string, DiscoveredSkill>();
  const locations = [
    path.join(LLM_PARTY_HOME, "skills"),
    path.join(process.cwd(), ".llm-party", "skills"),
    path.join(process.cwd(), ".claude", "skills"),
    path.join(process.cwd(), ".agents", "skills"),
  ];

  for (const location of locations) {
    try {
      const entries = await readdir(location, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(location, entry.name, "SKILL.md");
          try {
            await access(skillPath);
            skills.set(entry.name, { name: entry.name, path: skillPath });
          } catch {
            // No SKILL.md in this folder, skip
          }
        }
      }
    } catch {
      // Location doesn't exist, skip
    }
  }

  return skills;
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
  await ensureFile(path.join(memoryDir, "project.md"), "# Project Memory\n\n## Current State\n\nLast Updated:\nActive:\nBlockers:\nNext:\n\n---\n\n## Log\n\n---\n\n## Decisions\n");
}

export async function initLlmPartyHome(appRoot: string): Promise<void> {
  await mkdir(LLM_PARTY_HOME, { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "network"), { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "agents"), { recursive: true });
  await mkdir(path.join(LLM_PARTY_HOME, "skills"), { recursive: true });

  await ensureFile(path.join(LLM_PARTY_HOME, "network", "projects.yml"), "projects: []\n");
  await mkdir(path.join(LLM_PARTY_HOME, "network", "mind-map"), { recursive: true });
  await ensureFile(path.join(LLM_PARTY_HOME, "network", "mind-map", "INDEX.md"), MIND_MAP_INDEX);

}

export async function configExists(): Promise<boolean> {
  if (process.env.LLM_PARTY_CONFIG) {
    try {
      await access(path.resolve(process.env.LLM_PARTY_CONFIG));
      return true;
    } catch {
      return false;
    }
  }

  try {
    await access(path.join(LLM_PARTY_HOME, "config.json"));
    return true;
  } catch {
    return false;
  }
}

// TODO: Remove after 2026-06-01. Migrates legacy provider IDs (e.g. "glm") to "custom".
// No known users have legacy configs, but this prevents validation errors for anyone
// who upgraded from pre-v0.8 with a non-standard provider in their config.
function migrateProviders(data: Record<string, unknown>): void {
  if (!Array.isArray(data.agents)) return;
  for (const agent of data.agents) {
    if (!agent || typeof agent !== "object") continue;
    if (typeof agent.provider === "string" && !VALID_PROVIDER_IDS.has(agent.provider)) {
      agent.provider = "custom";
      if (!agent.cli) agent.cli = "claude";
    }
  }
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  migrateProviders(parsed);
  validateConfig(parsed);
  return normalizeConfig(parsed as Record<string, unknown>);
}

export { LLM_PARTY_HOME };
