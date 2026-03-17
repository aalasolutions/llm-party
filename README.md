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

## What makes this different

Most multi-agent setups use MCP (one agent controls others) or CLI wrapping (spawn processes and parse terminal output). Both are fragile.

llms-party uses SDK adapters directly. Each agent gets a persistent session with its provider. Full tool access. Real conversation threading. The orchestrator owns routing, not any single agent.

| Provider | SDK | Session Model |
|----------|-----|---------------|
| Claude | `@anthropic-ai/claude-agent-sdk` | Resume via session ID |
| Codex | `@openai/codex-sdk` | Persistent thread with `run()` turns |
| Copilot | `@github/copilot-sdk` | Persistent session with `sendAndWait()` |
| GLM | Claude Agent SDK + env routing | Same as Claude, routed through `api.z.ai` |

## WARNING: FULL AUTONOMY

This project runs with **dangerous full-permission behavior**. All agents can read, write, edit files and execute shell commands with zero approval gates.

You are fully responsible for any changes, data loss, costs, or side effects. The authors provide this software as-is with no warranties.

Do not run this against production infrastructure or repositories you cannot recover from.

## Quick start

```bash
npm install
npm run dev
```

Or build and run:

```bash
npm run build
npm start
```

Override config path:

```bash
LLMS_PARTY_CONFIG=/path/to/config.json npm run dev
```

## Terminal commands

| Command | What it does |
|---------|-------------|
| `/agents` | List active agents with tag, provider, model |
| `/history` | Print full conversation history |
| `/save <path>` | Export conversation as JSON |
| `/session` | Show session ID and transcript path |
| `/changes` | Show git-modified files |
| `/exit` | Quit |

## Routing

**Talk to one agent:**
```
@claude explain this error
```

**Talk to multiple:**
```
@claude @codex both of you review this
```

**Broadcast to all (no tag):**
```
what do you all think about this approach?
```

**Sticky targeting:** Once you tag an agent, subsequent untagged messages go to the same target until you switch.

**Agent handoff:** Agents can pass the conversation to each other using `@next:<tag>` in their response. Max 6 auto-hops before the system stops to prevent loops.

## Configuration

Config lives in `configs/default.json`:

```json
{
  "humanName": "AAMIR",
  "humanTag": "aamir",
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
      "tag": "codex",
      "provider": "codex",
      "model": "gpt-5.2",
      "systemPrompt": ["./prompts/base.md"],
      "permissions": "full-access",
      "executablePath": "/opt/homebrew/bin/codex"
    }
  ]
}
```

### Config fields

**Top level:**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `humanName` | No | `USER` | Your display name in the terminal prompt |
| `humanTag` | No | derived | Tag used for human handoff detection |
| `maxAutoHops` | No | `6` | Max agent-to-agent handoffs per cycle. Use `"unlimited"` to uncap |
| `agents` | Yes | | Array of agent definitions |

**Per agent:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `tag` | No | Routing tag (auto-generated from name if omitted) |
| `provider` | Yes | One of: `claude`, `codex`, `copilot`, `glm` |
| `model` | Yes | Model ID passed to the provider |
| `systemPrompt` | Yes | Path or array of paths to prompt markdown files |
| `permissions` | Yes | `full-access` or `read-only` |
| `executablePath` | No | Path to CLI binary if not in PATH |
| `env` | No | Environment variable overrides for the agent process |

### System prompts

Single file or multiple files merged in order:

```json
"systemPrompt": "./prompts/base.md"
"systemPrompt": ["./prompts/base.md", "./prompts/personality.md"]
```

Multiple files are concatenated with separators before template rendering. Template variables available in prompt files:

| Variable | Value |
|----------|-------|
| `{{agentName}}` | Agent's display name |
| `{{agentTag}}` | Agent's routing tag |
| `{{humanName}}` | Human's display name |
| `{{humanTag}}` | Human's routing tag |
| `{{agentCount}}` | Total number of active agents |
| `{{allAgentNames}}` | Comma-separated list of all agent names |
| `{{allAgentTags}}` | All agent tags formatted as @tag |
| `{{otherAgentList}}` | Formatted list of other agents with tags |
| `{{otherAgentNames}}` | Comma-separated names of other agents |
| `{{validHandoffTargets}}` | Valid `@next:tag` targets for handoff |

### Provider notes

**Claude and GLM** use `@anthropic-ai/claude-agent-sdk`. GLM routes through a proxy URL via environment overrides. System prompt is passed directly to the SDK.

**Copilot** uses `@github/copilot-sdk`. System prompt is set as `systemMessage` on session creation.

**Codex** uses `@openai/codex-sdk`. System prompt is injected via `developer_instructions` config key. Note: Codex has a large built-in system prompt (13k+ tokens) that cannot be overridden. Your instructions are appended alongside it. Functional instructions (naming, formatting, workflow rules) work well. Personality overrides do not.

## Session and transcript

Every run gets a unique session ID and a JSONL transcript file under `data/sessions/`.

File changes made by agents during their turns are detected automatically via `git status` and printed in the terminal with timestamps.

## Architecture

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

Each agent receives a rolling window of recent messages plus any unseen messages since its last turn. Messages from other agents are included so everyone sees the full conversation.

## Troubleshooting

**"ENOENT for prompt path"**: Your `systemPrompt` points to a file that does not exist. Check paths relative to project root.

**"No agent matched @tag"**: Run `/agents` to see available tags. Check `tag` values in your config.

**Agent goes rogue**: This is expected with full-access permissions. Agents can and will modify files. Use git to recover. Phase 2 will add permission controls.

## License

MIT
