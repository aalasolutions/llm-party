import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { Orchestrator } from "../orchestrator.js";
import { ConversationMessage } from "../types.js";

export async function runTerminal(orchestrator: Orchestrator): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const humanName = orchestrator.getHumanName();
  const tags = formatTagHints(orchestrator);
  let lastTargets: string[] | undefined;

  process.on("SIGINT", () => {
    rl.close();
    output.write("\n");
    process.exit(0);
  });

  output.write(
    chalk.cyan(
      `llms-party Phase 1 started. Commands: /agents, /history, /save <path>, /exit. Tags: ${tags}\n`
    )
  );

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

    await dispatchWithHandoffs(orchestrator, output, targets);
  }

  rl.close();
}

async function dispatchWithHandoffs(
  orchestrator: Orchestrator,
  out: NodeJS.WriteStream,
  initialTargets?: string[]
): Promise<void> {
  let targets = initialTargets;
  let hops = 0;
  const maxHops = 6;

  while (true) {
    const targetLabel = targets && targets.length > 0 ? targets.join(",") : "all";
    out.write(chalk.gray(`Dispatching to ${targetLabel}...\n`));

    const batch: ConversationMessage[] = [];
    await orchestrator.fanOutWithProgress(targets, (msg) => {
      batch.push(msg);
      out.write(chalk.magenta(`[${msg.from}]`) + ` ${msg.text}\n\n`);
    });

    const nextSelectors = extractNextSelectors(batch);
    if (nextSelectors.length === 0) {
      return;
    }

    if (
      nextSelectors.some((selector) => {
        const normalized = selector.toLowerCase();
        return normalized === orchestrator.getHumanTag().toLowerCase()
          || normalized === orchestrator.getHumanName().toLowerCase();
      })
    ) {
      return;
    }

    const resolvedTargets = Array.from(
      new Set(nextSelectors.flatMap((selector) => orchestrator.resolveTargets(selector)))
    );

    if (resolvedTargets.length === 0) {
      out.write(chalk.yellow(`Ignored @next target(s): ${nextSelectors.join(",")}\n`));
      return;
    }

    hops += 1;
    if (hops >= maxHops) {
      out.write(chalk.yellow(`Stopped auto-handoff after ${maxHops} hops to prevent loops.\n`));
      return;
    }

    out.write(chalk.gray(`Auto handoff via @next to ${resolvedTargets.join(",")}\n`));
    targets = resolvedTargets;
  }
}

function formatTagHints(orchestrator: Orchestrator): string {
  const agents = orchestrator.listAgents();
  const tags = new Set<string>();

  tags.add("@all");
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
