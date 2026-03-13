import { readFile } from "node:fs/promises";
import { AppConfig } from "../types.js";

export async function loadConfig(path: string): Promise<AppConfig> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AppConfig;
}
