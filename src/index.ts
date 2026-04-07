#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSignal, Show } from "solid-js";
import { render } from "@opentui/solid";
import { ClaudeAdapter } from "./adapters/claude.js";
import { CodexAdapter } from "./adapters/codex.js";
import { CopilotAdapter } from "./adapters/copilot.js";
import { CustomAdapter } from "./adapters/custom.js";
import { loadConfig, resolveConfigPath, resolveBasePrompt, resolveArtifactsPrompt, resolveObsidianPrompt, discoverSkills, initLlmPartyHome, configExists } from "./config/loader.js";
import { Orchestrator } from "./orchestrator.js";
import { App } from "./ui/App.js";
import { ConfigWizard } from "./ui/ConfigWizard.js";
import { toTag } from "./utils.js";
import type { AppConfig } from "./types.js";

interface BootResult {
  orchestrator: Orchestrator;
  config: AppConfig;
  configPath: string;
}

async function main(): Promise<void> {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  await initLlmPartyHome(appRoot);

  // Parse --resume <sessionId> from CLI args
  const resumeIndex = process.argv.indexOf("--resume");
  const resumeSessionId = resumeIndex !== -1 ? process.argv[resumeIndex + 1] : undefined;

  const rendererConfig = {
    exitOnCtrlC: false,
    useMouse: true,
    useKittyKeyboard: {},
  };

  const hasConfig = await configExists();

  if (!hasConfig) {
    // First run: single render, wizard first, then App after config saved
    const [boot, setBoot] = createSignal<BootResult | null>(null);

    await render(
      () => Show({
        get when() { return boot(); },
        get fallback() {
          return ConfigWizard({
            isFirstRun: true,
            onComplete: async () => {
              const result = await buildOrchestrator(appRoot, resumeSessionId);
              setBoot(result);
            },
          });
        },
        get children() {
          const b = boot();
          if (!b) return null;
          return App({
            orchestrator: b.orchestrator,
            config: b.config,
            configPath: b.configPath,
            resumeSessionId,
          });
        },
      }),
      rendererConfig
    );
  } else {
    const result = await buildOrchestrator(appRoot, resumeSessionId);
    await render(
      () => App({
        orchestrator: result.orchestrator,
        config: result.config,
        configPath: result.configPath,
        resumeSessionId,
      }),
      rendererConfig
    );
  }
}

async function buildOrchestrator(appRoot: string, resumeSessionId?: string): Promise<BootResult> {
  const configPath = await resolveConfigPath(appRoot);
  const config = await loadConfig(configPath);
  const humanName = config.humanName?.trim() || "USER";
  const humanTag = config.humanTag?.trim() || toTag(humanName);
  const maxAutoHops = resolveMaxAutoHops(config.maxAutoHops);

  const basePrompt = await resolveBasePrompt(appRoot);
  const artifactsPrompt = await resolveArtifactsPrompt(appRoot);
  const obsidianPrompt = await resolveObsidianPrompt(appRoot);
  const mergedBase = basePrompt + "\n\n---\n\n" + artifactsPrompt + "\n\n---\n\n" + obsidianPrompt;

  // Skill discovery
  const availableSkills = await discoverSkills();
  const agentVerifiedSkills = new Map<string, string[]>();

  // Filter out inactive agents
  const activeAgents = config.agents.filter((a) => a.active !== false);

  for (const agent of activeAgents) {
    if (agent.preloadSkills && agent.preloadSkills.length > 0) {
      const verified: string[] = [];
      const report: string[] = [];
      for (const skillName of agent.preloadSkills) {
        if (availableSkills.has(skillName)) {
          verified.push(skillName);
          report.push(`${skillName} \u2713`);
        } else {
          report.push(`${skillName} \u2717 not found`);
        }
      }
      agentVerifiedSkills.set(agent.name, verified);
      process.stdout.write(`Skills for ${agent.name}: ${report.join(", ")}\n`);
    }
  }

  const configDir = path.dirname(configPath);
  const resolveFromConfig = (value: string): string => {
    return path.isAbsolute(value) ? value : path.resolve(configDir, value);
  };

  const adapters = await Promise.all(
    activeAgents.map(async (agent, _index, allAgents) => {
      const promptParts = [mergedBase];

      if (agent.prompts && agent.prompts.length > 0) {
        const extraPaths = agent.prompts.map((p) => resolveFromConfig(p));
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
              const peerSkills = agentVerifiedSkills.get(peer.name) || [];
              const skillLabel = peerSkills.length > 0 ? ` [${peerSkills.join(", ")}]` : "";
              return `- ${peer.name}${skillLabel}: use @${peerTag}`;
            })
            .join("\n")
        : "- None";

      const validHandoffTargets = peers.length > 0
        ? peers.map((peer) => `@next:${peer.tag?.trim() || toTag(peer.name)}`).join(", ")
        : "none";

      const mySkills = agentVerifiedSkills.get(agent.name) || [];
      const preloadedSkills = mySkills.length > 0
        ? `The following skills are assigned to you. Load them at boot:\n${mySkills.map((s) => `- ${s}`).join("\n")}`
        : "";

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
        agentCount: String(allAgents.length),
        preloadedSkills,
      });

      const adapter =
        agent.provider === "claude"
          ? new ClaudeAdapter(agent.name, agent.model, humanName)
          : agent.provider === "codex"
            ? new CodexAdapter(agent.name, agent.model, humanName)
            : agent.provider === "copilot"
              ? new CopilotAdapter(agent.name, agent.model, humanName)
              : agent.provider === "custom"
                ? new CustomAdapter(agent.name, agent.model, humanName)
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
    activeAgents
      .filter((agent) => typeof agent.timeout === "number" && agent.timeout > 0)
      .map((agent) => [agent.name, agent.timeout! * 1000])
  );

  const orchestrator = new Orchestrator(
    adapters,
    humanName,
    Object.fromEntries(activeAgents.map((agent) => [agent.name, agent.tag?.trim() || toTag(agent.name)])),
    humanTag,
    defaultTimeout,
    agentTimeouts,
    { reminderInterval: config.reminderInterval, maxAutoHops }
  );

  return { orchestrator, config, configPath };
}

function resolveMaxAutoHops(value: number | undefined): number {
  if (typeof value === "number" && value === 0) {
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
