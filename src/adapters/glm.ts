import { spawn } from "node:child_process";
import { ClaudeBaseAdapter } from "./claude-base.js";
import { PersonaConfig } from "../types.js";

export class GlmAdapter extends ClaudeBaseAdapter {
  public provider = "glm";

  protected override async buildEnv(config: PersonaConfig): Promise<NodeJS.ProcessEnv> {
    const aliasEnv = await loadGlmAliasEnv();
    return { ...process.env, ...aliasEnv, ...(config.env ?? {}) };
  }
}

function detectShell(): string {
  if (process.env.SHELL) {
    return process.env.SHELL;
  }
  return "/bin/sh";
}

async function loadGlmAliasEnv(): Promise<NodeJS.ProcessEnv> {
  const shell = detectShell();
  const isInteractive = shell.endsWith("zsh") || shell.endsWith("bash");
  const args = isInteractive ? ["-ic", "alias glm"] : ["-c", "alias glm"];

  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({});
    }, 5000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({});
        return;
      }
      const env: NodeJS.ProcessEnv = {};
      const tokens = stdout.match(/[A-Z_]+="[^"]*"/g) ?? [];
      for (const token of tokens) {
        const eqIdx = token.indexOf("=");
        if (eqIdx === -1) continue;
        const key = token.slice(0, eqIdx);
        const raw = token.slice(eqIdx + 1);
        env[key] = raw.replace(/^"|"$/g, "");
      }
      resolve(env);
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolve({});
    });
  });
}
