<p align="center">
  <h1 align="center">llm-party</h1>
  <p align="center">
    <strong>Bring your models. We'll bring the party.</strong>
  </p>
  <p align="center">
    <a href="https://llm-party.party">Website</a> &middot;
    <a href="https://www.npmjs.com/package/llm-party">npm</a> &middot;
    <a href="https://github.com/aalasolutions/llm-party">GitHub</a>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/llm-party"><img src="https://img.shields.io/npm/v/llm-party?style=flat-square&color=cb3837" alt="npm version"></a>
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

| | Traditional multi-agent | llm-party |
|---|---|---|
| **Architecture** | MCP (master controls servants) | Peer orchestration (you control all) |
| **Integration** | CLI wrapping, output scraping | Direct SDK adapters |
| **Sessions** | Fresh each time | Persistent per provider |
| **Context** | Agents are siloed | Every agent sees the full conversation |
| **API tokens** | Separate keys per tool | Uses your existing CLI auth |

<br/>

## Getting started

### Install and run

```bash
npm install -g llm-party
llm-party
```

That's it. Agents use your current working directory. Config defaults are included in the package.

### Set up your agents

Edit `configs/default.json`. Each agent needs a name, provider, and model:

```json
{
  "humanName": "YOUR NAME",
  "agents": [
    {
      "name": "Claude",
      "tag": "claude",
      "provider": "claude",
      "model": "opus",
      "systemPrompt": ["./prompts/base.md"]
    },
    {
      "name": "Codex",
      "tag": "codex",
      "provider": "codex",
      "model": "gpt-5.2",
      "systemPrompt": ["./prompts/base.md"]
    }
  ]
}
```

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

<br/>

## Before you start

**Verify your CLIs work first.** Before adding an agent to `configs/default.json`, make sure its CLI is installed and authenticated:

```bash
claude --version        # Claude Code CLI
codex --version         # OpenAI Codex CLI
copilot --version       # GitHub Copilot CLI
```

If a CLI doesn't work on its own, it won't work inside llm-party.

**No extra API tokens.** llm-party uses the original CLIs and SDKs under the hood. Your existing authentication and subscriptions are used directly. Sessions created by agents appear in each tool's native session history (Claude Code sessions, Codex threads, etc.) since the underlying SDKs manage their own persistence.

**Run in isolation.** Always run llm-party inside a disposable environment: a Docker container, a VM, or at minimum a throwaway git branch. Agents have full filesystem and shell access with zero approval gates.

<br/>

## How we use the SDKs

llm-party uses **official, publicly available SDKs and CLIs** published by each provider. Nothing is reverse-engineered, patched, or bypassed.

| Provider | Official SDK | Published by |
|----------|-------------|-------------|
| Claude | [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) | Anthropic |
| Codex | [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) | OpenAI |
| Copilot | [`@github/copilot-sdk`](https://www.npmjs.com/package/@github/copilot-sdk) | GitHub |

All authentication flows through the provider's own CLI login. Your API keys, OAuth tokens, and subscriptions are used as-is. llm-party does not store, proxy, or intercept credentials.

If any provider believes this project violates their terms of service, please [open an issue](https://github.com/aalasolutions/llm-party/issues) and we will address it immediately.

## Supported providers

| Provider | SDK | Session | System Prompt |
|----------|-----|---------|---------------|
| **Claude** | `@anthropic-ai/claude-agent-sdk` | Persistent via session ID resume | Full control |
| **Codex** | `@openai/codex-sdk` | Persistent thread with `run()` turns | Via `developer_instructions` (see limitations) |
| **Copilot** | `@github/copilot-sdk` | Persistent via `sendAndWait()` | Full control |
| **GLM** | Claude SDK + env proxy | Same as Claude | Full control |

<br/>

---

<br/>

## How it works

Most multi-agent setups use MCP (one agent controls others) or CLI wrapping (spawn processes and scrape terminal output). Both are fragile and hierarchical.

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

Each agent receives a rolling window of recent messages (default 16) plus any unseen messages since its last turn. Messages from other agents are included so everyone sees the full multi-party conversation.

<br/>

## Provider details

### Claude

| | |
|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` |
| Session | Persistent via `resume: sessionId`. First call creates a session, subsequent calls resume it. |
| System prompt | Passed directly to the SDK via `options.systemPrompt`. Full control. |
| Tools | Read, Write, Edit, Bash, Glob, Grep |
| Permissions | `permissionMode: "bypassPermissions"` (all tools auto-approved) |

System prompt works exactly as expected. Personality, behavior, workflow rules all respected.

### Codex

| | |
|---|---|
| SDK | `@openai/codex-sdk` |
| Session | Persistent thread. `startThread()` creates it, `thread.run()` adds turns to the same conversation. |
| System prompt | Injected via `developer_instructions` config key, passed as `--config` flag to the CLI subprocess. |
| Tools | exec_command, apply_patch, file operations (Codex built-in toolset) |
| Permissions | `sandboxMode: "danger-full-access"`, `approvalPolicy: "never"` |

**Known limitation:** Codex ships with a massive built-in system prompt (~13k tokens) that cannot be overridden. Your `developer_instructions` are appended alongside it, not replacing it. This means:

- **Works:** Action instructions (create files, follow naming conventions), formatting rules (prefix responses with agent name), workflow rules (handoff syntax, routing tags)
- **Does not work:** Personality overrides, identity changes, behavioral rewrites

We tested `instructions`, `developer_instructions`, and `experimental_instructions_file`. All three append to the built-in prompt. None replace it.

**Also observed:** Codex is aggressive with file operations. When asked to "create your file," it read the orchestrator source code, ran the Codex CLI, and modified `src/ui/terminal.ts` instead of just creating a simple markdown file.

### Copilot

| | |
|---|---|
| SDK | `@github/copilot-sdk` |
| Session | Persistent via `CopilotClient.createSession()`. Messages sent with `session.sendAndWait()`. |
| System prompt | Set as `systemMessage: { content: prompt }` on session creation. |
| Tools | Copilot built-in toolset |
| Permissions | `onPermissionRequest: approveAll` (all actions auto-approved) |

System prompt works as expected.

### GLM

| | |
|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` (same as Claude) |
| Session | Same as Claude, but routed through a proxy. |
| System prompt | Same as Claude. Full control. |
| Tools | Same as Claude |
| Permissions | Same as Claude |

GLM is not tied to any specific CLI. It uses the Claude SDK as the transport layer because Claude Code supports environment variable overrides for base URL and model aliases, making it a convenient proxy bridge. Any CLI that supports similar env-based routing could be swapped in.

<br/>

## Config reference

Config file: `configs/default.json`. Override with `LLM_PARTY_CONFIG` env var.

### Top-level fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `humanName` | No | `USER` | Your name displayed in the terminal prompt and passed to agents |
| `humanTag` | No | derived from `humanName` | Tag used for human handoff detection. When an agent says `@next:you`, the orchestrator stops and returns control to you |
| `maxAutoHops` | No | `15` | Max agent-to-agent handoffs per cycle. Prevents infinite loops. Use `"unlimited"` to remove the cap |
| `timeout` | No | `600` | Default timeout in seconds for all agents. 10 minutes by default |
| `agents` | Yes | | Array of agent definitions. Must have at least one |

### Agent fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | | Display name shown in responses as `[AGENT NAME]` |
| `tag` | No | derived from `name` | Routing tag for `@tag` targeting. Auto-generated as lowercase with dashes if omitted |
| `provider` | Yes | | SDK adapter: `claude`, `codex`, `copilot`, or `glm` |
| `model` | Yes | | Model ID passed to the provider. Examples: `opus`, `sonnet`, `gpt-5.2`, `gpt-4.1`, `glm-5` |
| `systemPrompt` | Yes | | Path or array of paths to prompt markdown files. Relative to project root |
| `executablePath` | No | PATH lookup | Path to the CLI binary. Supports `~/` for home directory. Only needed if the CLI is not in your PATH |
| `env` | No | inherits `process.env` | Environment variable overrides for this agent's process |
| `timeout` | No | top-level value | Per-agent timeout in seconds. Overrides the top-level default |

### System prompts

Single file or multiple files merged in order:

```json
"systemPrompt": "./prompts/base.md"
"systemPrompt": ["./prompts/base.md", "./prompts/reviewer.md"]
```

Files are concatenated with `---` separators, then template variables are replaced. Available variables:

| Variable | Description |
|----------|-------------|
| `{{agentName}}` | This agent's display name |
| `{{agentTag}}` | This agent's routing tag |
| `{{humanName}}` | The human's display name |
| `{{humanTag}}` | The human's routing tag |
| `{{agentCount}}` | Total number of active agents |
| `{{allAgentNames}}` | All agent names, comma-separated |
| `{{allAgentTags}}` | All agent tags as `@tag` |
| `{{otherAgentList}}` | Other agents formatted as `- Name: use @tag` |
| `{{otherAgentNames}}` | Other agent names, comma-separated |
| `{{validHandoffTargets}}` | Valid `@next:tag` values for handoff |

### GLM environment setup

GLM requires environment overrides to route through a proxy. The adapter first tries to load env variables from your shell `glm` alias (`zsh -ic "alias glm"`). If you have a `glm` alias that sets `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`, it picks those up automatically.

Without the alias, provide everything in the `env` block:

```json
{
  "name": "GLM Agent",
  "provider": "glm",
  "model": "glm-5",
  "systemPrompt": ["./prompts/base.md"],
  "executablePath": "~/.local/bin/claude",
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

Every run generates a unique session ID and appends messages to a JSONL transcript file under `.llm-party/sessions/`. The session ID and transcript path are printed at startup.

File changes made by agents during their turns are detected via `git status` after each response cycle. Newly modified files are printed with timestamps.

Use `/save <path>` to export the full in-memory conversation as formatted JSON.

<br/>

## Terminal commands

| Command | What it does |
|---------|-------------|
| `/agents` | List active agents with tag, provider, model |
| `/history` | Print full conversation history |
| `/save <path>` | Export conversation as JSON |
| `/session` | Show session ID and transcript path |
| `/changes` | Show git-modified files |
| `/exit` | Quit |

<br/>

## Development

```bash
git clone https://github.com/aalasolutions/llm-party.git
cd llm-party
npm install
npm run dev
```

Build and run from dist:

```bash
npm run build
npm start
```

Override config path:

```bash
LLM_PARTY_CONFIG=/path/to/config.json npm run dev
```

<br/>

## Troubleshooting

**"ENOENT for prompt path"**
Your `systemPrompt` points to a file that does not exist. Paths are relative to project root. Verify with `ls prompts/`.

**"No agent matched @tag"**
The tag you typed does not match any agent's `tag`, `name`, or `provider`. Run `/agents` to see what is available.

**"Unsupported provider"**
Your config has a provider value that is not one of: `claude`, `codex`, `copilot`, `glm`.

**Agent modifies source code unexpectedly**
Expected behavior with full-access permissions. Agents can read, write, and execute anything. Use git to review and revert. Codex in particular is aggressive with file operations.

**Codex ignores personality instructions**
Known limitation. Codex has a 13k+ token built-in system prompt that overrides personality and identity instructions. Functional instructions (naming, workflow, formatting) still work.

**Agent response timeout**
Claude and Copilot have a 120-second timeout. GLM has 240 seconds. If an agent consistently times out, check your API keys and network connectivity.

<br/>

## Warning

All agents run with **full permissions**. They can read, write, edit files and execute shell commands. There is no confirmation step before any action.

You are responsible for any changes, data loss, costs, or side effects. Do not run against production systems or repos you cannot recover from.

<br/>

<p align="center">
  <a href="https://llm-party.party">llm-party.party</a> &middot;
  Built by <a href="https://aalasolutions.com">AALA Solutions</a>
</p>
