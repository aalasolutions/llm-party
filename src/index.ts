#!/usr/bin/env bun
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import { ClaudeAdapter } from "./adapters/claude.js";
import { CodexAdapter } from "./adapters/codex.js";
import { CopilotAdapter } from "./adapters/copilot.js";
import { GlmAdapter } from "./adapters/glm.js";
import { loadConfig, resolveConfigPath, resolveBasePrompt, resolveArtifactsPrompt, initLlmPartyHome, configExists } from "./config/loader.js";
import { Orchestrator } from "./orchestrator.js";
import { App } from "./ui/App.js";
import { ConfigWizard } from "./ui/ConfigWizard.js";
import { toTag } from "./utils.js";

async function main(): Promise<void> {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  await initLlmPartyHome(appRoot);

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    useKittyKeyboard: {},
  });

  process.on("SIGINT", () => {
    renderer.destroy();
  });

  const root = createRoot(renderer);
  const hasConfig = await configExists();

  if (!hasConfig) {
    root.render(
      React.createElement(ConfigWizard, {
        isFirstRun: true,
        onComplete: async () => {
          await bootApp(appRoot, renderer, root);
        },
      })
    );
  } else {
    await bootApp(appRoot, renderer, root);
  }
}

async function bootApp(appRoot: string, renderer: CliRenderer, root: Root): Promise<void> {
  const configPath = await resolveConfigPath(appRoot);
  const config = await loadConfig(configPath);
  const humanName = config.humanName?.trim() || "USER";
  const humanTag = config.humanTag?.trim() || toTag(humanName);
  const maxAutoHops = resolveMaxAutoHops(config.maxAutoHops);

  const basePrompt = await resolveBasePrompt(appRoot);
  const artifactsPrompt = await resolveArtifactsPrompt(appRoot);
  const mergedBase = basePrompt + "\n\n---\n\n" + artifactsPrompt;

  const resolveFromAppRoot = (value: string): string => {
    return path.isAbsolute(value) ? value : path.resolve(appRoot, value);
  };

  const adapters = await Promise.all(
    config.agents.map(async (agent, _index, allAgents) => {
      const promptParts = [mergedBase];

      if (agent.prompts && agent.prompts.length > 0) {
        const extraPaths = agent.prompts.map((p) => resolveFromAppRoot(p));
        const extraParts = await Promise.all(extraPaths.map((p) => readFile(p, "utf8")));
        promptParts.push(...extraParts);
      }

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
          : agent.provider === "codex"
            ? new CodexAdapter(agent.name, agent.model)
            : agent.provider === "copilot"
              ? new CopilotAdapter(agent.name, agent.model)
              : agent.provider === "glm"
                ? new GlmAdapter(agent.name, agent.model)
                : null;

      if (!adapter) {
        throw new Error(`Unsupported provider: ${agent.provider}`);
      }

      await adapter.init({ ...agent, resolvedPrompt: prompt });
      return adapter;
    })
  );

  const defaultTimeout = typeof config.timeout === "number" && config.timeout > 0
    ? config.timeout * 1000
    : 600000;
  const agentTimeouts = Object.fromEntries(
    config.agents
      .filter((agent) => typeof agent.timeout === "number" && agent.timeout > 0)
      .map((agent) => [agent.name, agent.timeout! * 1000])
  );

  const orchestrator = new Orchestrator(
    adapters,
    humanName,
    Object.fromEntries(config.agents.map((agent) => [agent.name, agent.tag?.trim() || toTag(agent.name)])),
    humanTag,
    defaultTimeout,
    agentTimeouts
  );

  root.render(
    React.createElement(App, { orchestrator, maxAutoHops, renderer, config })
  );
}

function resolveMaxAutoHops(value: number | "unlimited" | undefined): number {
  if (value === "unlimited") {
    return Number.POSITIVE_INFINITY;
  }

  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }

  return 15;
}

function renderPromptTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return variables[key] ?? "";
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
