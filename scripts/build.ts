#!/usr/bin/env bun

import solidPlugin from "@opentui/solid/bun-plugin";

await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  external: ["@anthropic-ai/claude-agent-sdk"],
  plugins: [solidPlugin],
});
