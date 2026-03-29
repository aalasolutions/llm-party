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
  skills/
```

---

### `.llm-party/TASKS.md`

Task list for this project. Written before work starts. Updated immediately on completion.

**Format:**
```markdown
# Tasks

- [ ] AGENT:@{{agentTag}} | Task description | Date Added
- [x] AGENT:@{{agentTag}} | Task description | Date Added | Date completed
```

Rules:
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

---

## Decisions

DATE | AGENT:@{{agentTag}} | DECISION | WHY | CONSEQUENCES
```

Rules:
- `Current State` block is overwritten each update. Keep it short. It is a snapshot, not a history.
- `Log` section is append-only. Never edit or delete past entries.
- `Decisions` section is append-only. Record decisions that emerge from discussion with {{humanName}}.

---

### `.llm-party/skills/`

Project-local skills. Each skill is a folder containing a `SKILL.md` file:

```
skills/
  skill-name/
    SKILL.md          # Required. YAML frontmatter (name, description) + markdown instructions.
    scripts/           # Optional. Executable code (Python/JS) for deterministic tasks.
    references/        # Optional. Docs loaded into context as needed.
    assets/            # Optional. Templates, icons, fonts used in output.
```

Agents read relevant skills before executing unfamiliar workflows. Keep `SKILL.md` concise (under 5,000 words) and offload detail into `references/`.

---

## Global: `~/.llm-party/`

Created when {{humanName}} requests initialization or the orchestrator runs an init command. Shared across all projects.

```
~/.llm-party/
  network/
    projects.yml
    mind-map/
  agents/
    {{agentTag}}.md
    {{agentTag}}-handoff.md
  skills/
    skill-name/
      SKILL.md
```

Additional folders/files (`config.json` etc.) may be added by the orchestrator code. Their schemas are managed in code, not in this prompt.

---

### `~/.llm-party/network/projects.yml`

Living map of all projects. Written by agents when a project-level milestone or cross-project decision happens.

**Schema:**
```yaml
projects:
  - id: unique-slug
    name: Human-readable name
    root_path: /absolute/path/to/project
    tags: [web, api, cli, creative, horror-story, chicken recipe]
    stack: [typescript, node, postgres, salt, vineger]
    history:
      - date: YYYY-MM-DD
        agent: agentTag
        event: 25 words max describing what happened
```

Rules:
- `history` is append-only within each project entry
- Write here when a decision affects multiple projects or a milestone is reached

---

### `~/.llm-party/network/mind-map/`

Obsidian-compatible folder. Each discovery is its own `.md` file with frontmatter and wikilinks. Users can open this folder in Obsidian to visualize the knowledge graph.

**Note format:**
```markdown
---
discovered: YYYY-MM-DD
agent: agentTag
projects: [project-slug]
tags: [relevant, tags]
---

# Descriptive Title

What the constraint or discovery is.

## Workaround
How to work around it.

## Related
- [[other-discovery-filename]]
```

**File naming:** slugified title, e.g. `react-19-useeffect.md`, `figma-autolayout-nesting.md`.

Rules:
- Write here when a tool or resource constraint is discovered that would trap a future session
- Include workaround. A constraint without a workaround is incomplete.
- Use `[[wikilinks]]` to connect related discoveries

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
