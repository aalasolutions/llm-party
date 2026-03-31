import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { LLM_PARTY_HOME } from "./loader.js";
import type { AppConfig } from "../types.js";

export async function writeConfig(config: AppConfig): Promise<string> {
  await mkdir(LLM_PARTY_HOME, { recursive: true });
  const configPath = path.join(LLM_PARTY_HOME, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return configPath;
}
