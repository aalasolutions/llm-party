# Artifacts

File and folder schemas for every artifact the system reads and writes.
No behavioral rules here. Structure and format only.

---

## Per-Project: `.llm-party/`

Created when {{humanName}} requests initialization or the orchestrator runs an init command. 

```
.llm-party/
  TASKS.md
  memory/
    project.md
    decisions.md
  skills/
```

---

### `.llm-party/TASKS.md`

Task list for this project. Written before work starts. Updated immediately on completion.

**Format:**
```markdown
# Tasks

- [ ] Task description
- [x] Completed task
```

Rules:
- One task per line
- `- [ ]` pending, `- [x]` done
- Add tasks BEFORE starting work
- Mark done IMMEDIATELY on completion, not at session end

---

### `.llm-party/memory/project.md`

Working log for this project. Two zones: Current State (overwritable) and Log (append-only).

**Template:**
```markdown
# Project Memory

## Current State

Last Updated: YYYY-MM-DD
Active: [what is being worked on right now]
Blockers: [anything blocking progress]
Next: [immediate next action]

---

## Log

DATE | AGENT:@{{agentTag}} | AREA | DETAIL
```

Rules:
- `Current State` block is overwritten each update. Keep it short. It is a snapshot, not a history.
- `Log` section is append-only. Never edit or delete past entries.

---

### `.llm-party/memory/decisions.md`

Locked decisions only. Nothing gets written here without explicit confirmation from {{humanName}}.

**Template:**
```markdown
# Decisions

DATE | AGENT:@{{agentTag}} | DECISION | WHY | CONSEQUENCES | CONFIRMED_BY:{{humanName}}
```

Rules:
- Append-only. Never edit or delete past entries.
- Only write when {{humanName}} explicitly confirms ("yes", "locked", "go ahead", "do it").
- Agent proposals go to `project.md` prefixed with `PROPOSED:`, not here.
- One agent writes per decision: the one {{humanName}} was talking to when confirmed.

---

### `.llm-party/skills/`

Project-local operating instructions and reusable workflows.

Each skill is a `.md` file. Agents read relevant skills before executing unfamiliar workflows.

No fixed schema. Content is written by {{humanName}} or agents when instructed.

---

## Global: `~/.llm-party/`

Created when {{humanName}} requests initialization or the orchestrator runs an init command. Shared across all projects.

```
~/.llm-party/
  network/
    projects.yml
    libraries.yml
  agents/
    {{agentTag}}.md
```

Additional folders/files (`config.json`, `sessions/`, etc.) may be added by the orchestrator code. Their schemas are managed in code, not in this prompt.

---

### `~/.llm-party/network/projects.yml`

Living map of all projects. Written by agents when a project-level milestone or cross-project decision happens.

**Schema:**
```yaml
projects:
  - id: unique-slug
    name: Human-readable name
    root_path: /absolute/path/to/project
    tags: [web, api, cli]
    stack: [typescript, node, postgres]
    history:
      - date: YYYY-MM-DD
        agent: agentTag
        event: 25 words max describing what happened
```

Rules:
- `history` is append-only within each project entry
- Write here when a decision affects multiple projects or a milestone is reached

---

### `~/.llm-party/network/libraries.yml`

Hard-won library knowledge. Limitations, workarounds, version constraints.

**Schema:**
```yaml
libraries:
  - name: library-name
    version: "x.y.z or range or null"
    limitation: what the library cannot do or does wrong
    workaround: how to work around it
    discovered: YYYY-MM-DD
    agent: agentTag
    projects:
      - project-slug
```

Rules:
- Write here when a library limitation is discovered that would trap a future session
- Include workaround. A limitation without a workaround is incomplete.

---

### `~/.llm-party/agents/{{agentTag}}.md`

Per-agent self memory. Not shared between agents. Each agent owns its own file.

**Template:**
```markdown
# {{agentName}} Self Memory

DATE | RULE | EXAMPLE
```

Rules:
- Write IMMEDIATELY when a correction is received or a non-obvious approach is confirmed
- Per-agent: one file per agent, named `{{agentTag}}.md`
- Append-only

---
