#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeAdapter } from "./adapters/claude.js";
import { GlmAdapter } from "./adapters/glm.js";
import { loadConfig } from "./config/loader.js";
import { Orchestrator } from "./orchestrator.js";
import { runTerminal } from "./ui/terminal.js";

async function main(): Promise<void> {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = process.env.LLMS_PARTY_CONFIG
    ? path.resolve(process.env.LLMS_PARTY_CONFIG)
    : path.join(appRoot, "configs", "default.json");
  const config = await loadConfig(configPath);
  const humanName = config.humanName?.trim() || "USER";
  const humanTag = config.humanTag?.trim() || toTag(humanName);
  const resolveFromAppRoot = (value: string): string => {
    return path.isAbsolute(value) ? value : path.resolve(appRoot, value);
  };

  const adapters = await Promise.all(
    config.agents.map(async (agent, index, allAgents) => {
      const promptPaths = Array.isArray(agent.systemPrompt)
        ? agent.systemPrompt.map((p) => resolveFromAppRoot(p))
        : [resolveFromAppRoot(agent.systemPrompt)];
      const promptParts = await Promise.all(promptPaths.map((p) => readFile(p, "utf8")));
      const promptTemplate = promptParts.join("\n\n---\n\n");
      const peers = allAgents.filter((candidate) => candidate.name !== agent.name);
      const tag = agent.tag?.trim() || toTag(agent.name);
      const otherAgentList = peers.length > 0
        ? peers
            .map((peer) => {
              const peerTag = peer.tag?.trim() || toTag(peer.name);
              return `- ${peer.name}: use @${peerTag}`;
            })
            .join("\n")
        : "- None";

      const validHandoffTargets = peers.length > 0
        ? peers.map((peer) => `@next:${peer.tag?.trim() || toTag(peer.name)}`).join(", ")
        : "none";

      const prompt = renderPromptTemplate(promptTemplate, {
        humanName,
        humanTag,
        agentName: agent.name,
        agentTag: tag,
        validHandoffTargets,
        otherAgentList,
        otherAgentNames: peers.map((peer) => peer.name).join(", ") || "none",
        allAgentNames: allAgents.map((candidate) => candidate.name).join(", "),
        allAgentTags: allAgents.map((candidate) => `@${candidate.tag?.trim() || toTag(candidate.name)}`).join(", "),
        agentCount: String(allAgents.length)
      });

      const adapter =
        agent.provider === "claude"
          ? new ClaudeAdapter(agent.name, agent.model)
          : agent.provider === "glm"
            ? new GlmAdapter(agent.name, agent.model)
            : null;

      if (!adapter) {
        throw new Error(`Unsupported provider in Phase 1: ${agent.provider}`);
      }

      await adapter.init({ ...agent, systemPrompt: prompt });
      return adapter;
    })
  );

  const orchestrator = new Orchestrator(
    adapters,
    humanName,
    Object.fromEntries(config.agents.map((agent) => [agent.name, agent.tag?.trim() || toTag(agent.name)])),
    humanTag
  );
  await runTerminal(orchestrator);
}

function renderPromptTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return variables[key] ?? "";
  });
}

function toTag(value: string): string {
  const compact = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return compact || "agent";
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
