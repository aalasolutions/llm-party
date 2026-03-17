# llms-party

One terminal. Every AI. No hierarchy.

A peer orchestrator that puts Claude, Codex, Copilot, and GLM in the same room. You talk, they listen. They talk to each other. Nobody is the boss except you.

```
YOU > @claude review this function
[CLAUDE] The error handling on line 42 swallows exceptions silently...

YOU > @codex fix what claude found
[CODEX] Fixed. Wrapped in try/catch with proper logging. See diff below.

YOU > @copilot write tests for the fix
[COPILOT] Added 3 test cases covering the happy path and both error branches.
```

No MCP. No master/servant. No window juggling. Just peers at a terminal table.

## Getting started

### Install and run

```bash
npm install -g llms-party
llm-party
```

That's it. Agents use your current working directory. Config defaults are included in the package.

### Set up your agents

Edit `configs/default.json`. Each agent needs a name, provider, and model:

```json
{
  "humanName": "AAMIR",
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

**Important:** Once you tag an agent, all follow-up messages without a tag go to that same agent. Use `@all` or `@everyone` to broadcast again.

### Agent handoff

Agents can pass the conversation to each other by ending their response with `@next:<tag>`. The orchestrator picks it up and dispatches automatically. Max 6 hops per cycle to prevent loops.

## WARNING: FULL AUTONOMY

All agents run with **full permissions**. They can read, write, edit files and execute shell commands with zero approval gates. There is no confirmation step before any action.

You are responsible for any changes, data loss, costs, or side effects.

Do not run against production systems or repos you cannot recover from. Use git.

---

## How it works

Most multi-agent setups use MCP (one agent controls others) or CLI wrapping (spawn processes and scrape terminal output). Both are fragile and hierarchical.

llms-party uses SDK adapters directly. Each agent gets a persistent session with its provider. Full tool access. Real conversation threading. The orchestrator owns routing, agents are peers.

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

## Providers

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
- **Does not work:** Personality overrides ("you are a pirate"), identity changes ("your name is Bob and you are 43 years old"), behavioral rewrites

We tested `instructions`, `developer_instructions`, and `experimental_instructions_file`. All three append to the built-in prompt. None replace it. The model's "I am a coding assistant" identity is baked into fine-tuning, not just the prompt.

**Also observed:** Codex is aggressive with file operations. When asked to "create your file," it read the orchestrator source code, ran the Codex CLI, and modified `src/ui/terminal.ts` instead of just creating a simple markdown file. Full-access permissions means full-access behavior.

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
| Session | Same as Claude, but routed through `api.z.ai/api/anthropic` proxy. |
| System prompt | Same as Claude. Full control. |
| Tools | Same as Claude |
| Permissions | Same as Claude |

GLM is not tied to any specific CLI. It uses the Claude SDK as the transport layer because Claude Code supports environment variable overrides for base URL and model aliases, making it a convenient proxy bridge. Any CLI that supports similar env-based routing could be swapped in. The adapter sets `ANTHROPIC_BASE_URL` to route API calls through a proxy and maps model names via env overrides. Requires `env` block in config with the proxy URL and model mappings.

## Config reference

Config file: `configs/default.json`. Override with `LLMS_PARTY_CONFIG` env var.

### Top-level fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `humanName` | No | `USER` | Your name displayed in the terminal prompt and passed to agents |
| `humanTag` | No | derived from `humanName` | Tag used for human handoff detection. When an agent says `@next:aamir`, the orchestrator stops auto-handoff and returns control to you |
| `maxAutoHops` | No | `6` | Max agent-to-agent handoffs per cycle. Prevents infinite loops. Use `"unlimited"` to remove the cap |
| `agents` | Yes | | Array of agent definitions. Must have at least one |

### Agent fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | | Display name shown in responses as `[AGENT NAME]`. Must be non-empty |
| `tag` | No | derived from `name` | Routing tag for `@tag` targeting. Auto-generated as lowercase alphanumeric with dashes if omitted. Case-insensitive at runtime |
| `provider` | Yes | | Which SDK adapter to use. One of: `claude`, `codex`, `copilot`, `glm` |
| `model` | Yes | | Model ID passed to the provider SDK. Examples: `opus`, `sonnet`, `gpt-5.2`, `gpt-4.1`, `glm-5` |
| `systemPrompt` | Yes | | Path (string) or array of paths to markdown prompt files. Relative paths resolve from project root. Files are read, concatenated with `\n\n---\n\n` separator, then template variables are rendered |
| `executablePath` | No | SDK default or PATH lookup | Path to the provider's CLI binary. Only needed if the CLI is not in your PATH or you want to pin a specific version. Claude/GLM need the `claude` binary. Codex needs the `codex` binary. Copilot resolves its own binary |
| `env` | No | inherits `process.env` | Key-value environment variable overrides for this agent's process. Used by GLM to set the proxy URL and model aliases. Can also pass API keys per agent |

### System prompts

Single file:
```json
"systemPrompt": "./prompts/base.md"
```

Multiple files merged in order:
```json
"systemPrompt": ["./prompts/base.md", "./prompts/reviewer.md"]
```

Files are concatenated with `---` separators, then template variables are replaced before passing to the adapter. Available variables:

| Variable | Description |
|----------|-------------|
| `{{agentName}}` | This agent's display name |
| `{{agentTag}}` | This agent's routing tag |
| `{{humanName}}` | The human's display name |
| `{{humanTag}}` | The human's routing tag |
| `{{agentCount}}` | Total number of active agents |
| `{{allAgentNames}}` | All agent names, comma-separated |
| `{{allAgentTags}}` | All agent tags as `@tag`, comma-separated |
| `{{otherAgentList}}` | Other agents formatted as `- Name: use @tag` |
| `{{otherAgentNames}}` | Other agent names, comma-separated |
| `{{validHandoffTargets}}` | Valid `@next:tag` values for handoff |

### GLM environment setup

GLM requires environment overrides to route through the proxy. The adapter first tries to load env variables from your shell `glm` alias (`zsh -ic "alias glm"`). If you have a `glm` alias that sets `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`, it will pick those up automatically.

If you don't have the alias, provide everything in the `env` block:

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

## Session and transcript

Every run generates a unique session ID and appends messages to a JSONL transcript file under `data/sessions/`. The session ID and transcript path are printed at startup.

File changes made by agents during their turns are detected via `git status --porcelain` after each response cycle. Newly modified files are printed with timestamps.

Use `/save <path>` to export the full in-memory conversation as formatted JSON at any point.

## Terminal commands

| Command | What it does |
|---------|-------------|
| `/agents` | List active agents with tag, provider, model |
| `/history` | Print full conversation history |
| `/save <path>` | Export conversation as JSON |
| `/session` | Show session ID and transcript path |
| `/changes` | Show git-modified files |
| `/exit` | Quit |

## Development

```bash
git clone <repo>
cd llms-party
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
LLMS_PARTY_CONFIG=/path/to/config.json npm run dev
```

## Troubleshooting

**"ENOENT for prompt path"**
Your `systemPrompt` points to a file that does not exist. Paths are relative to project root. Verify with `ls prompts/`.

**"No agent matched @tag"**
The tag you typed does not match any agent's `tag`, `name`, or `provider`. Run `/agents` to see what is available.

**"Unsupported provider"**
Your config has a provider value that is not one of: `claude`, `codex`, `copilot`, `glm`.

**Agent modifies source code unexpectedly**
This is expected behavior with full-access permissions. All agents can read, write, and execute anything. Use git to review and revert. Codex in particular is aggressive with file operations.

**Codex ignores personality instructions**
This is a known limitation. Codex has a 13k+ token built-in system prompt that overrides personality and identity instructions. Functional instructions (naming, workflow, formatting) still work.

**Agent response timeout**
Claude and Copilot have a 120-second timeout. GLM has 240 seconds. If an agent consistently times out, check your API keys and network connectivity.

## License

MIT
