import { spawn } from "node:child_process";
import { PROVIDERS } from "./defaults.js";

export interface DetectionResult {
  id: string;
  available: boolean;
  version?: string;
}

const DETECT_TIMEOUT = 5000;

function detectBinary(command: string): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ available: false }), DETECT_TIMEOUT);

    const proc = spawn(command, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DETECT_TIMEOUT,
    });

    let output = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        available: code === 0,
        version: code === 0 ? output.trim().split("\n")[0] : undefined,
      });
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ available: false });
    });
  });
}

function detectAlias(command: string): Promise<{ available: boolean }> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/bash";
    const timer = setTimeout(() => resolve({ available: false }), DETECT_TIMEOUT);

    const proc = spawn(shell, ["-ic", `type ${command}`], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DETECT_TIMEOUT,
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ available: code === 0 });
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ available: false });
    });
  });
}

export async function detectProviders(): Promise<DetectionResult[]> {
  const results = await Promise.allSettled(
    PROVIDERS.map(async (provider) => {
      const result =
        provider.detectType === "alias"
          ? await detectAlias(provider.detectCommand)
          : await detectBinary(provider.detectCommand);

      return {
        id: provider.id,
        available: result.available,
        version: "version" in result ? result.version : undefined,
      };
    })
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return { id: PROVIDERS[i].id, available: false };
  });
}
