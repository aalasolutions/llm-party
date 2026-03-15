# llms-party

A terminal-first multi-agent orchestrator. Run multiple LLM agents as peers in one session, route messages by tags, support agent-to-agent handoff using `@next:<tag>`, and keep a per-session transcript.

## WARNING: FULL AUTONOMY / USE AT YOUR OWN RISK

This project is configured to run with dangerous full-permission behavior (`dangerously-skip-permissions` in adapter options, with `full-access` agent configs).

What this means:

- Agents can read, write, and edit files in your workspace.
- Agents can execute shell commands through enabled tools.
- Actions may be destructive, expensive, or irreversible.
- There is no approval gate in this implementation before tool execution.

Liability notice:

- You are fully responsible for any changes, data loss, outages, costs, or side effects caused by running this project.
- The authors and contributors provide this software as-is, with no warranties and no liability.

Do not run this against sensitive systems, production infrastructure, or repositories you cannot recover from.

## What This Project Is

- One terminal UI to talk to multiple agents.
- Agents are configured in `configs/default.json`.
- Each agent has its own provider, model, tag, prompt, and optional env overrides.
- Messages can be broadcast or targeted.
- Agents can hand off to each other in plain text with `@next:<tag>`.
- Transcript is written per run to `data/sessions/transcript-<sessionId>.jsonl`.
- File changes made during LLM turns are shown automatically in terminal.

## Current Providers

- `claude` (Claude Agent SDK)
- `copilot` (GitHub Copilot SDK)
- `glm` (GLM via Claude Agent SDK with env overrides)

## Quick Start

Install globally:

```bash
npm i -g llms-party
```

Run from any folder:

```bash
llm-party
```

Agents use your current working directory. Config defaults to `configs/default.json` inside the package.

Override config path:

```bash
LLMS_PARTY_CONFIG=/absolute/path/to/config.json llm-party
```

## Terminal Commands

- `/agents` lists active agents with tag, provider, and model.
- `/history` prints in-memory conversation history.
- `/save <path>` saves full in-memory history JSON.
- `/session` prints current session id and transcript path.
- `/changes` prints currently modified files from git working tree.
- `/exit` exits.

## Routing Rules

User message routing:

- `@tag message` routes only to that target.
- Mentions inside text also route targets, for example: `Please review @agent1 and @agent2`.
- If no explicit tag is present, it reuses the last explicit target set.
- If no last target exists, it broadcasts to all agents.

Agent-to-agent handoff:

- Agents can output `@next:<tag>`.
- The orchestrator resolves and dispatches to that target.
- Max auto-handoff depth is 6 hops per cycle.
- Handoff to human tag (for example `@next:user`) stops auto-handoff.

## Config Management

Main config file: `configs/default.json`

### Top-Level Fields

- `humanName` optional display name in terminal prompt.
- `humanTag` optional tag used for human handoff detection.
- `maxAutoHops` optional handoff cap. Use a number like `20` or `"unlimited"`. Default is `6`.
- `agents` array of agent definitions.

### Agent Fields

- `name` required display name.
- `tag` optional routing tag. If omitted, generated from `name`.
- `provider` required, one of `claude`, `copilot`, or `glm`.
- `model` required model id/name passed to adapter.
- `systemPrompt` required path or array of paths.
- `permissions` required, one of `full-access` or `read-only`.
- `executablePath` optional path to CLI executable (`claude` for claude/glm providers, `copilot` for copilot provider). Only needed if the CLI is not in your PATH.
- `env` optional key-value overrides for that agent process.

### systemPrompt: Single or Multiple Files

`systemPrompt` supports:

- Single file:

```json
"systemPrompt": "./prompts/base.md"
```

- Multiple files merged in order:

```json
"systemPrompt": ["./prompts/base.md", "./prompts/agent1.md"]
```

When multiple files are used, content is concatenated with separators before template rendering.

### Prompt Template Variables

Available placeholders in prompt files:

- `{{humanName}}`
- `{{humanTag}}`
- `{{agentName}}`
- `{{agentTag}}`
- `{{validHandoffTargets}}`
- `{{otherAgentList}}`
- `{{otherAgentNames}}`
- `{{allAgentNames}}`
- `{{allAgentTags}}`
- `{{agentCount}}`

### Config Example

Use one shared base prompt and optional per-agent overlay prompt:

```json
{
  "humanName": "USER",
  "humanTag": "user",
  "maxAutoHops": 6,
  "agents": [
    {
      "name": "Agent 1",
      "tag": "agent1",
      "provider": "claude",
      "model": "opus",
      "systemPrompt": ["./prompts/base.md"],
      "permissions": "full-access"
    },
    {
      "name": "Agent 2",
      "tag": "agent2",
      "provider": "copilot",
      "model": "gpt-4.1",
      "systemPrompt": ["./prompts/base.md"],
      "permissions": "full-access"
    },
    {
      "name": "Agent 3",
      "tag": "agent3",
      "provider": "glm",
      "model": "glm-5",
      "systemPrompt": ["./prompts/base.md"],
      "permissions": "full-access",
      "env": {
        "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.5",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5"
      }
    }
  ]
}
```

## Session Files and Output

- Session transcript path is printed at startup.
- Every session gets a unique transcript JSONL file.
- `/save <path>` writes pretty JSON history snapshot for manual export.
- During each LLM turn, newly changed files are printed automatically.

## How To Know What LLM Modified

You have two mechanisms:

- Automatic: after each LLM response cycle, new changed files are printed with timestamp.
- Manual: run `/changes` at any time.

Both are based on git working tree status.

## Troubleshooting

### ENOENT for prompt path

Cause:

- `systemPrompt` points to a file that does not exist.

Fix:

- Ensure every path in `systemPrompt` exists.
- Use paths relative to project root (recommended), or absolute paths.

### No agent matched @tag

Cause:

- Unknown tag/name/provider.

Fix:

- Run `/agents` and use listed tags.
- Check `tag` values in `configs/default.json`.

### Ctrl+C abort error

Status:

- Already handled. Ctrl+C now exits cleanly.

## Notes

- Keep `configs/default.json` as the source of truth.
- For clear behavior separation, keep shared rules in `prompts/base.md` and agent-specific style in separate prompt files.
- If two agents share exactly the same prompt and model, expect similar outputs.
