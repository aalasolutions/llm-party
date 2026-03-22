<p align="center">
  <h1 align="center">llm-party</h1>
  <p align="center">
    <strong>Bring your models. We'll bring the party.</strong>
  </p>
  <p align="center">
    <a href="https://llm-party.party">Website</a> ·
    <a href="https://www.npmjs.com/package/llm-party-cli">npm</a> ·
    <a href="https://github.com/aalasolutions/llm-party">GitHub</a>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/llm-party-cli"><img src="https://img.shields.io/npm/v/llm-party-cli?style=flat-square&color=cb3837" alt="npm version"></a>
    <a href="https://github.com/aalasolutions/llm-party/blob/main/LICENSE"><img src="https://img.shields.io/github/license/aalasolutions/llm-party?style=flat-square" alt="license"></a>
    <a href="https://github.com/aalasolutions/llm-party"><img src="https://img.shields.io/github/stars/aalasolutions/llm-party?style=flat-square" alt="stars"></a>
  </p>
</p>

<br/>

A peer orchestrator that puts **Claude**, **Codex**, **Copilot**, and **GLM** in the same terminal. You talk, they listen. They talk to each other. Nobody is the boss except you.

```
YOU > @claude review this function
[CLAUDE] The error handling on line 42 swallows exceptions silently...

YOU > @codex fix what claude found
[CODEX] Fixed. Wrapped in try/catch with proper logging. See diff below.

YOU > @copilot write tests for the fix
[COPILOT] Added 3 test cases covering the happy path and both error branches.
```

No MCP. No master/servant. No window juggling. Just peers at a terminal table.

<br/>

## Why llm-party?

|                        | Traditional multi-agent        | llm-party                              |
| ---------------------- | ------------------------------ | -------------------------------------- |
| **Architecture** | MCP (master controls servants) | Peer orchestration (you control all)   |
| **Integration**  | CLI wrapping, output scraping  | Direct SDK adapters                    |
| **Sessions**     | Fresh each time                | Persistent per provider                |
| **Context**      | Agents are siloed              | Every agent sees the full conversation |
| **API tokens**   | Separate keys per tool         | Uses your existing CLI auth            |

<br/>

## Getting started

### Prerequisites

Bun runtime and Node.js 20+ are required (22+ if using the Copilot provider, which depends on `node:sqlite`). Make sure at least one AI CLI is installed and authenticated:

```bash
claude --version        # Claude Code CLI
codex --version         # OpenAI Codex CLI
copilot --version       # GitHub Copilot CLI
```

If a CLI doesn't work on its own, it won't work inside llm-party.

### Install

```bash
npm install -g llm-party-cli
```

### First run

```bash
llm-party
```

On first run, llm-party automatically creates `~/.llm-party/` with a default config and global memory structure. Your system username is detected automatically. No setup commands needed.

### Add more agents

Edit `~/.llm-party/config.json`:

```json
{
  "agents": [
    {
      "name": "Claude",
      "tag": "claude",
      "provider": "claude",
      "model": "opus"
    },
    {
      "name": "Codex",
      "tag": "codex",
      "provider": "codex",
      "model": "gpt-5.2"
    },
    {
      "name": "Copilot",
      "tag": "copilot",
      "provider": "copilot",
      "model": "gpt-4.1"
    }
  ]
}
```

That's it. No paths, no prompts, no usernames to configure. Just name, tag, provider, model.

### Talk to your agents

```
@claude explain this error          # talk to one agent
@claude @codex review this          # talk to multiple
@all what does everyone think?      # broadcast to all agents
@everyone same as @all              # alias
```

> **Note:** Once you tag an agent, all follow-up messages without a tag go to that same agent. Use `@all` or `@everyone` to broadcast again.

### Agent-to-agent handoff

Agents can pass the conversation to each other by ending their response with `@next:<tag>`. The orchestrator picks it up and dispatches automatically. Max 15 hops per cycle to prevent loops.

## **WARNING: FULL AUTONOMY.**

All agents run with full permissions. They can read, write, edit files and execute shell commands with zero approval gates. There is no confirmation step before any action. Run in a disposable environment. You are responsible for any changes, data loss, costs, or side effects. Do not run against production systems.

## Important notes

**Uses your existing CLIs.** llm-party uses official SDKs that delegate to each provider's CLI binary. If `claude`, `codex`, or `copilot` commands work on your machine, llm-party works. Authentication is handled entirely by the provider's own tools.

**Run in isolation.** Always run llm-party inside a disposable environment: a Docker container, a VM, or at minimum a throwaway git branch. Agents have full filesystem and shell access with zero approval gates.

**Full permissions.** All agents can read, write, edit files and execute shell commands. There is no confirmation step before any action. You are responsible for any changes, data loss, costs, or side effects.

<br/>

## How we use the SDKs

llm-party uses **official, publicly available SDKs and CLIs** published by each provider. Nothing is reverse-engineered, patched, or bypassed.

| Provider | Official SDK                                                                                    | Published by |
| -------- | ----------------------------------------------------------------------------------------------- | ------------ |
| Claude   | [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Anthropic    |
| Codex    | [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk)                           | OpenAI       |
| Copilot  | [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk)                       | GitHub       |

All authentication flows through the provider's own CLI. llm-party does not implement its own auth flow, store credentials, or intercept authentication traffic.

<br/>

## Supported providers

| Provider          | SDK                                | Session                                | Prompt Support                                     |
| ----------------- | ---------------------------------- | -------------------------------------- | -------------------------------------------------- |
| **Claude**  | `@anthropic-ai/claude-agent-sdk` | Persistent via session ID resume       | Full control                                       |
| **Codex**   | `@openai/codex-sdk`              | Persistent thread with `run()` turns | Via `developer_instructions` (limitations below) |
| **Copilot** | `@github/copilot-sdk`            | Persistent via `sendAndWait()`       | Full control                                       |
| **GLM**     | Claude SDK + env proxy             | Same as Claude                         | Full control                                       |

<br/>

---

<br/>

## How it works

llm-party uses SDK adapters directly. Each agent gets a persistent session with its provider. Full tool access. Real conversation threading. The orchestrator owns routing, agents are peers.

```
Terminal (you)
    |
    v
Orchestrator
    |
    +-- Agent Registry
    |     +-- Claude  -> ClaudeAdapter  (SDK session, resume by ID)
    |     +-- Codex   -> CodexAdapter   (SDK thread, persistent turns)
    |     +-- Copilot -> CopilotAdapter (SDK session, sendAndWait)
    |     +-- GLM     -> GlmAdapter     (Claude SDK + env proxy)
    |
    +-- Conversation Log (ordered, all messages, agent-prefixed)
    |
    +-- Transcript Writer (JSONL, append-only, per session)
```

Each agent receives a rolling window of recent messages (configurable, default 16) plus any unseen messages since its last turn. Messages from other agents are included so everyone sees the full multi-party conversation.

`~/.llm-party/config.json` is your global config. Every agent receives a base system prompt automatically. The `prompts` field in config adds extra prompt files on top of it.

<br/>

## Provider details

### Claude

|         |                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------- |
| SDK     | `@anthropic-ai/claude-agent-sdk`                                                              |
| Session | Persistent via `resume: sessionId`. First call creates a session, subsequent calls resume it. |
| Prompt  | Passed directly to the SDK. Full control over personality, behavior, and workflow rules.        |
| Tools   | Read, Write, Edit, Bash, Glob, Grep                                                             |

### Codex

|         |                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------- |
| SDK     | `@openai/codex-sdk`                                                                                            |
| Session | Persistent thread.`startThread()` creates it, `thread.run()` adds turns to the same conversation.            |
| Prompt  | Injected via `developer_instructions` config key. Appended alongside Codex's built-in 13k token system prompt. |
| Tools   | exec_command, apply_patch, file operations                                                                       |

**Known limitation:** Codex's built-in system prompt cannot be overridden. Your instructions are appended alongside it. Action instructions (naming, formatting, workflow rules) work. Personality overrides do not.

### Copilot

|         |                                                             |
| ------- | ----------------------------------------------------------- |
| SDK     | `@github/copilot-sdk`                                     |
| Session | Persistent via `CopilotClient.createSession()`.           |
| Prompt  | Set as `systemMessage` on session creation. Full control. |
| Tools   | Copilot built-in toolset                                    |

### GLM

|         |                                                           |
| ------- | --------------------------------------------------------- |
| SDK     | `@anthropic-ai/claude-agent-sdk` (same as Claude)       |
| Session | Same as Claude, routed through a proxy via env overrides. |
| Prompt  | Same as Claude. Full control.                             |
| Tools   | Same as Claude                                            |

GLM uses the Claude SDK as a transport layer. The adapter routes API calls through a proxy by setting `ANTHROPIC_BASE_URL` and model aliases via the `env` config field.

<br/>

## Config reference

Config file: `~/.llm-party/config.json` (created automatically on first run).

Override with `LLM_PARTY_CONFIG` env var to point to a different file.

### Top-level fields

| Field           | Required | Default                    | Description                                                                  |
| --------------- | -------- | -------------------------- | ---------------------------------------------------------------------------- |
| `humanName`   | No       | Your system username       | Display name in the terminal prompt and passed to agents                     |
| `humanTag`    | No       | derived from `humanName` | Tag for human handoff detection (`@next:you`)                              |
| `maxAutoHops` | No       | `15`                     | Max agent-to-agent handoffs per cycle. Use `"unlimited"` to remove the cap |
| `timeout`     | No       | `600`                    | Default timeout in seconds for all agents                                    |
| `agents`      | Yes      |                            | Array of agent definitions                                                   |

### Agent fields

| Field              | Required | Default                  | Description                                                                                         |
| ------------------ | -------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `name`           | Yes      |                          | Display name shown in responses as `[AGENT NAME]`. Must be unique.                                |
| `tag`            | No       | derived from `name`    | Routing tag for `@tag` targeting                                                                  |
| `provider`       | Yes      |                          | SDK adapter:`claude`, `codex`, `copilot`, or `glm`                                          |
| `model`          | Yes      |                          | Model ID passed to the provider. Examples:`opus`, `sonnet`, `gpt-5.2`, `gpt-4.1`, `glm-5` |
| `prompts`        | No       | none                     | Array of extra prompt file paths, concatenated after `base.md`. Relative to project root          |
| `executablePath` | No       | PATH lookup              | Path to the CLI binary. Supports `~/`. Only needed if the CLI is not in your PATH                 |
| `env`            | No       | inherits `process.env` | Environment variable overrides for this agent                                                       |
| `timeout`        | No       | top-level value          | Per-agent timeout override in seconds                                                               |

### Prompts

Every agent receives a base system prompt automatically. To add extra instructions per agent, use the `prompts` field:

```json
{
  "name": "Reviewer",
  "tag": "reviewer",
  "provider": "claude",
  "model": "opus",
  "prompts": ["./prompts/code-review.md"]
}
```

Template variables available in prompt files:

| Variable                    | Description                   |
| --------------------------- | ----------------------------- |
| `{{agentName}}`           | This agent's display name     |
| `{{agentTag}}`            | This agent's routing tag      |
| `{{humanName}}`           | Your display name             |
| `{{humanTag}}`            | Your routing tag              |
| `{{agentCount}}`          | Total number of active agents |
| `{{allAgentNames}}`       | All agent names               |
| `{{allAgentTags}}`        | All agent tags as `@tag`    |
| `{{otherAgentList}}`      | Other agents with their tags  |
| `{{validHandoffTargets}}` | Valid `@next:tag` targets   |

### GLM environment setup

GLM requires environment overrides to route through a proxy. The adapter tries to load env variables from your shell `glm` alias automatically. Without the alias, provide everything in the `env` block:

```json
{
  "name": "GLM",
  "provider": "glm",
  "model": "glm-5",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-glm-api-key",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.5",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5"
  }
}
```

<br/>

## Session and transcript

Every run generates a unique session ID and appends messages to a JSONL transcript in `.llm-party/sessions/` (project-level). The session ID and transcript path are printed at startup.

File changes made by agents are detected via `git status` after each response. Newly modified files are printed with timestamps.

<br/>

## Terminal commands

| Command          | What it does                                 |
| ---------------- | -------------------------------------------- |
| `/agents`      | Open agents panel overlay (Ctrl+P also works) |
| `/config`      | Open config wizard                                |
| `/save <path>` | Export conversation as JSON                       |
| `/session`     | Show session ID and transcript path               |
| `/changes`     | Show git-modified files                           |
| `/clear`       | Clear chat display (Ctrl+L also works)            |
| `/exit`        | Quit (graceful shutdown, all adapters cleaned up) |
| `Ctrl+P`       | Toggle agents panel                               |
| `Ctrl+C`       | Exit (or copy selected text if selection active)  |

<br/>

## Development

```bash
git clone https://github.com/aalasolutions/llm-party.git
cd llm-party
bun install
bun run dev
```

Build and run:

```bash
bun run build
bun start
```

Override config:

```bash
LLM_PARTY_CONFIG=/path/to/config.json bun run dev
```

<br/>

## Troubleshooting

**"No agent matched @tag"**
Run `/agents` to see available tags. Tags match against agent `tag`, `name`, and `provider`.

**"Unsupported provider"**
Valid providers: `claude`, `codex`, `copilot`, `glm`.

**"Duplicate agent name"**
Agent names must be unique (case-insensitive). Rename one of the duplicates in config.

**Agent modifies source code unexpectedly**
Expected with full permissions. Use git to review and revert.

**Codex ignores personality instructions**
Known limitation. Codex's 13k token built-in prompt overrides personality. Functional instructions still work.

**"ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite"**
Your Node.js version is below 22. The Copilot SDK requires Node.js 22+.

**Agent response timeout**
Default is 600 seconds (10 minutes). Adjust with `timeout` in config (top-level or per-agent).

<br/>

<p align="center">
  <a href="https://llm-party.party">llm-party.party</a> ·
  Built by <a href="https://aalasolutions.com">AALA Solutions</a>
</p>
