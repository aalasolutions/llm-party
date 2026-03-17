import readline from "node:readline/promises";
import { execFile } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { Orchestrator } from "../orchestrator.js";
import { ConversationMessage } from "../types.js";

interface TerminalOptions {
  maxAutoHops?: number;
}

export async function runTerminal(orchestrator: Orchestrator, options: TerminalOptions = {}): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const humanName = orchestrator.getHumanName();
  const tags = formatTagHints(orchestrator);
  let lastTargets: string[] | undefined;
  let knownChangedFiles = await getChangedFiles();

  process.on("SIGINT", () => {
    rl.close();
    output.write("\n");
    process.exit(0);
  });

  output.write(
    chalk.cyan(
      `llms-party Phase 1 started. Commands: /agents, /history, /save <path>, /session, /changes, /exit. Tags: ${tags}\n`
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
      break;
    }

    if (line === "/history") {
      const history = orchestrator.getHistory();
      for (const msg of history) {
        output.write(`${chalk.gray(msg.createdAt)} ${chalk.yellow("[" + msg.from + "]")} ${msg.text}\n`);
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
    const explicitTargets = routing.targets && routing.targets.length > 0
      ? Array.from(new Set(routing.targets.flatMap((target) => orchestrator.resolveTargets(target))))
      : undefined;
    if (routing.targets && routing.targets.length > 0 && (!explicitTargets || explicitTargets.length === 0)) {
      output.write(chalk.red(`No agent matched ${routing.targets.map((target) => `@${target}`).join(", ")}. Use /agents to list names/providers.\n`));
      continue;
    }

    const targets = explicitTargets ?? lastTargets;
    if (explicitTargets && explicitTargets.length > 0) {
      lastTargets = explicitTargets;
    }

    const userMessage = orchestrator.addUserMessage(routing.message);
    await orchestrator.appendTranscript(userMessage);

    knownChangedFiles = await dispatchWithHandoffs(
      orchestrator,
      output,
      targets,
      knownChangedFiles,
      options.maxAutoHops ?? 6
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
        .map((line) => line.trim())
        .filter((line) => line.length > 3)
        .map((line) => line.slice(3).trim());

      resolve(Array.from(new Set(files)));
    });
  });
}

async function dispatchWithHandoffs(
  orchestrator: Orchestrator,
  out: NodeJS.WriteStream,
  initialTargets?: string[],
  previousChangedFiles: string[] = [],
  maxHops = 6
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
      out.write(chalk.magenta(`[${msg.from}]`) + ` ${msg.text}\n\n`);
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

function parseRouting(line: string): { targets?: string[]; message: string } {
  const normalizedStart = line.replace(/^[^A-Za-z0-9@_-]+/, "");
  const startMatch = normalizedStart.match(/^@([A-Za-z0-9_-]+)[\.,:;!?-]*\s+([\s\S]+)$/);
  if (startMatch) {
    return {
      targets: [startMatch[1].toLowerCase()],
      message: startMatch[2].trim()
    };
  }

  const mentionRegex = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]+)\b/g;
  const targets: string[] = [];
  let stripped = line;
  let match: RegExpExecArray | null = null;

  while ((match = mentionRegex.exec(line)) !== null) {
    targets.push(match[2].toLowerCase());
  }

  if (targets.length === 0) {
    return { message: line };
  }

  stripped = stripped.replace(/(^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]+)\b/g, (full, prefix) => prefix || "");
  stripped = stripped.replace(/\s{2,}/g, " ").trim();

  return {
    targets,
    message: stripped || line
  };
}
