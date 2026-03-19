import readline from "node:readline/promises";
import { execFile } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { Orchestrator } from "../orchestrator.js";
import { ConversationMessage } from "../types.js";
import { initProjectFolder } from "../config/loader.js";
import { formatAgentLabel } from "../utils.js";

interface TerminalOptions {
  maxAutoHops?: number;
}

export async function runTerminal(orchestrator: Orchestrator, options: TerminalOptions = {}): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const humanName = orchestrator.getHumanName();
  const tags = formatTagHints(orchestrator);
  const agentProviders = new Map(
    orchestrator.listAgents().map((a) => [a.name.toUpperCase(), a.provider])
  );
  const labelFor = (from: string): string => {
    const provider = agentProviders.get(from);
    return provider ? formatAgentLabel(from, provider) : from;
  };
  let lastTargets: string[] | undefined;
  let knownChangedFiles = await getChangedFiles();
  let projectFolderReady = false;

  async function gracefulShutdown(): Promise<void> {
    output.write(chalk.gray("\nShutting down adapters...\n"));
    const adapters = orchestrator.getAdapters();
    await Promise.allSettled(adapters.map((a) => a.destroy()));
    rl.close();
    process.exit(0);
  }

  process.on("SIGINT", () => {
    gracefulShutdown();
  });

  process.on("SIGTERM", () => {
    gracefulShutdown();
  });

  output.write(
    chalk.cyan(
      `llm-party Phase 1 started. Commands: /agents, /history, /save <path>, /session, /changes, /exit. Tags: ${tags}\n`
    )
  );
  output.write(chalk.gray(`Session: ${orchestrator.getSessionId()}\n`));
  output.write(chalk.gray(`Transcript: ${orchestrator.getTranscriptPath()}\n`));

  while (true) {
    let line = "";
    try {
      line = (await rl.question(chalk.green(`${humanName} > `))).trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ERR_USE_AFTER_CLOSE" || code === "ABORT_ERR") {
        break;
      }

      throw error;
    }

    if (!line) {
      continue;
    }

    if (line === "/exit") {
      await gracefulShutdown();
      break;
    }

    if (line === "/history") {
      const history = orchestrator.getHistory();
      for (const msg of history) {
        output.write(`${chalk.gray(msg.createdAt)} ${chalk.yellow("[" + labelFor(msg.from) + "]")} ${msg.text}\n`);
      }
      continue;
    }

    if (line === "/agents") {
      const agents = orchestrator.listAgents();
      for (const agent of agents) {
        output.write(`${chalk.cyan(agent.name)} tag=@${agent.tag} provider=${agent.provider} model=${agent.model}\n`);
      }
      continue;
    }

    if (line === "/session") {
      output.write(chalk.cyan(`Session: ${orchestrator.getSessionId()}\n`));
      output.write(chalk.cyan(`Transcript: ${orchestrator.getTranscriptPath()}\n`));
      continue;
    }

    if (line === "/changes") {
      const changedFiles = await getChangedFiles();
      if (changedFiles.length === 0) {
        output.write(chalk.cyan("No modified files in git working tree.\n"));
      } else {
        output.write(chalk.cyan("Modified files:\n"));
        for (const file of changedFiles) {
          output.write(`- ${file}\n`);
        }
      }
      continue;
    }

    if (line.startsWith("/save ")) {
      const filePath = line.replace("/save ", "").trim();
      if (!filePath) {
        output.write(chalk.red("Usage: /save <path>\n"));
        continue;
      }
      await orchestrator.saveHistory(filePath);
      output.write(chalk.cyan(`Saved history to ${filePath}\n`));
      continue;
    }

    const routing = parseRouting(line);
    const matchedTags = new Set<string>();
    const resolvedAgents: string[] = [];

    for (const mention of routing.mentions) {
      const resolved = orchestrator.resolveTargets(mention);
      if (resolved.length > 0) {
        matchedTags.add(mention);
        resolvedAgents.push(...resolved);
      }
    }

    const explicitTargets = resolvedAgents.length > 0
      ? Array.from(new Set(resolvedAgents))
      : undefined;

    const targets = explicitTargets ?? lastTargets;
    if (explicitTargets && explicitTargets.length > 0) {
      lastTargets = explicitTargets;
    }

    if (!projectFolderReady) {
      await initProjectFolder(process.cwd());
      projectFolderReady = true;
    }

    const message = matchedTags.size > 0
      ? stripMatchedTags(routing.raw, matchedTags)
      : routing.raw;
    const userMessage = orchestrator.addUserMessage(message);
    await orchestrator.appendTranscript(userMessage);

    knownChangedFiles = await dispatchWithHandoffs(
      orchestrator,
      output,
      labelFor,
      targets,
      knownChangedFiles,
      options.maxAutoHops ?? 15
    );
  }

  rl.close();
}

async function getChangedFiles(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("git", ["status", "--porcelain"], { cwd: process.cwd() }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      const files = stdout
        .split("\n")
        .filter((line) => line.length >= 4)
        .map((line) => line.slice(3));

      resolve(Array.from(new Set(files)));
    });
  });
}

async function dispatchWithHandoffs(
  orchestrator: Orchestrator,
  out: NodeJS.WriteStream,
  labelFor: (from: string) => string,
  initialTargets?: string[],
  previousChangedFiles: string[] = [],
  maxHops = 15
): Promise<string[]> {
  let targets = initialTargets;
  let hops = 0;
  let knownChangedFiles = previousChangedFiles;

  while (true) {
    const targetLabel = targets && targets.length > 0 ? targets.join(",") : "all";
    out.write(chalk.gray(`Dispatching to ${targetLabel}...\n`));

    const batch: ConversationMessage[] = [];
    await orchestrator.fanOutWithProgress(targets, (msg) => {
      batch.push(msg);
      out.write(chalk.magenta(`[${labelFor(msg.from)}]`) + ` ${msg.text}\n\n`);
    });

    const latestChangedFiles = await getChangedFiles();
    const newlyChanged = diffChangedFiles(knownChangedFiles, latestChangedFiles);
    if (newlyChanged.length > 0) {
      out.write(chalk.yellow(`LLM modified files at ${new Date().toISOString()}:\n`));
      for (const file of newlyChanged) {
        out.write(chalk.yellow(`- ${file}\n`));
      }
    }
    knownChangedFiles = latestChangedFiles;

    const nextSelectors = extractNextSelectors(batch);
    if (nextSelectors.length === 0) {
      return knownChangedFiles;
    }

    if (
      nextSelectors.some((selector) => {
        const normalized = selector.toLowerCase();
        return normalized === orchestrator.getHumanTag().toLowerCase()
          || normalized === orchestrator.getHumanName().toLowerCase();
      })
    ) {
      return knownChangedFiles;
    }

    const resolvedTargets = Array.from(
      new Set(nextSelectors.flatMap((selector) => orchestrator.resolveTargets(selector)))
    );

    if (resolvedTargets.length === 0) {
      out.write(chalk.yellow(`Ignored @next target(s): ${nextSelectors.join(",")}\n`));
      return knownChangedFiles;
    }

    hops += 1;
    if (Number.isFinite(maxHops) && hops >= maxHops) {
      out.write(chalk.yellow(`Stopped auto-handoff after ${maxHops} hops to prevent loops.\n`));
      return knownChangedFiles;
    }

    out.write(chalk.gray(`Auto handoff via @next to ${resolvedTargets.join(",")}\n`));
    targets = resolvedTargets;
  }
}

function diffChangedFiles(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((file) => !beforeSet.has(file));
}

function formatTagHints(orchestrator: Orchestrator): string {
  const agents = orchestrator.listAgents();
  const tags = new Set<string>();

  tags.add("@all");
  tags.add("@everyone");
  for (const agent of agents) {
    tags.add(`@${agent.tag}`);
    tags.add(`@${agent.provider}`);
  }

  return Array.from(tags).join(", ");
}

function extractNextSelectors(messages: ConversationMessage[]): string[] {
  const selectors: string[] = [];

  for (const msg of messages) {
    const regex = /@next\s*:\s*([A-Za-z0-9_-]+)/gi;
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(msg.text)) !== null) {
      selectors.push(match[1]);
    }

    const controlMatch = msg.text.match(/@control[\s\S]*?next\s*:\s*([A-Za-z0-9_-]+)[\s\S]*?@end/i);
    if (controlMatch?.[1]) {
      selectors.push(controlMatch[1]);
    }
  }

  return selectors;
}

function parseRouting(line: string): { mentions: string[]; raw: string } {
  const mentionRegex = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]+)\b/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = mentionRegex.exec(line)) !== null) {
    mentions.push(match[2].toLowerCase());
  }

  return { mentions, raw: line };
}

function stripMatchedTags(line: string, matchedTags: Set<string>): string {
  return line
    .replace(/(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]+)\b/g, (_match, prefix, tag) => {
      return matchedTags.has(tag.toLowerCase()) ? (prefix || "") : _match;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}
