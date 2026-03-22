import { writeFile, mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { PROVIDERS } from "./defaults.js";
import type { AppConfig, PersonaConfig } from "../types.js";

const LLM_PARTY_HOME = path.join(homedir(), ".llm-party");

export interface AgentOverride {
  id: string;
  name?: string;
  tag?: string;
  model?: string;
}

export async function writeWizardConfig(
  selectedIds: string[],
  overrides?: AgentOverride[]
): Promise<string> {
  const overrideMap = new Map(
    (overrides || []).map((o) => [o.id, o])
  );

  const agents: PersonaConfig[] = selectedIds.map((id) => {
    const def = PROVIDERS.find((p) => p.id === id);
    if (!def) throw new Error(`Unknown provider: ${id}`);

    const override = overrideMap.get(id);
    const agent: PersonaConfig = {
      name: override?.name || def.displayName,
      tag: override?.tag || def.defaultTag,
      provider: def.id,
      model: override?.model || def.defaultModel,
    };

    if (def.env) {
      agent.env = { ...def.env };
    }

    return agent;
  });

  const config: AppConfig = {
    humanName: userInfo().username || "USER",
    maxAutoHops: 15,
    agents,
  };

  await mkdir(LLM_PARTY_HOME, { recursive: true });
  const configPath = path.join(LLM_PARTY_HOME, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return configPath;
}
