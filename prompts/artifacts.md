# Artifacts

Canonical schemas and rules for the files agents read and write.

---

## Per-Project: `.llm-party/`

```text
.llm-party/
  TASKS.md
  memory/
    project.md
  plans/
    YYYY-MM-DD-title.md
  skills/
```

### `.llm-party/TASKS.md`

```markdown
# Tasks

- [ ] AGENT:@{{agentTag}} | Task description | Date Added
- [x] AGENT:@{{agentTag}} | Task description | Date Added | Date Completed
```

Rules:
- Add tasks before complex work starts
- Mark completion immediately

### `.llm-party/memory/project.md`

```markdown
# Project Memory

## Current State

Last Updated: YYYY-MM-DD
Active: current work
Blockers: current blockers
Next: immediate next action

---

## Log

DATE | AGENT:@{{agentTag}} | AREA | DETAIL

---

## Decisions

DATE | AGENT:@{{agentTag}} | DECISION | WHY | CONSEQUENCES
```

Rules:
- `Current State` is a short overwriteable snapshot
- `Log` is append-only
- `Decisions` is append-only
- When logging a fix, decision, or incident, include provenance in `DETAIL` when available, such as session, ticket, PR, host, path, or command.

### `.llm-party/plans/`

Filename: `YYYY-MM-DD-title.md`

```markdown
---
date: YYYY-MM-DD
status: planning | in-progress | completed | rejected
agents: [@agentTag]
---

# Title

## Context
Why this plan exists.

## Phase 1: Description

### Area

**Files to change:**

| File | Lines | Change |
|------|-------|--------|
| `path/to/file.ts` | 10, 37 | What changes and why |

- [ ] Task
  - [ ] Subtask if needed
- [ ] Task

## Phase 2: Description

- [ ] Task

## Open Questions

- [ ] Question
```

Rules:
- Frontmatter is required
- Share the plan before execution
- Update status and checkboxes as work progresses
- One plan per concern

### `.llm-party/skills/`

```text
skills/
  skill-name/
    SKILL.md
    scripts/
    references/
    assets/
```

Rules:
- `SKILL.md` is required
- Keep `SKILL.md` concise and move bulk detail to `references/`

---

## Global: `~/.llm-party/`

```text
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

### `~/.llm-party/network/projects.yml`

```yaml
projects:
  - id: unique-slug
    name: Human-readable name
    root_path: /absolute/path/to/project
    tags: [web, api, cli]
    stack: [typescript, node]
    history:
      - date: YYYY-MM-DD
        agent: agentTag
        event: short milestone or decision
```

Rules:
- `history` is append-only
- Use it for milestones and cross-project decisions
- Keep it breadcrumb-sized and include a short reference when useful, such as a session, ticket, PR, host, or memory file.

### `~/.llm-party/network/mind-map/`

```markdown
---
discovered: YYYY-MM-DD
agent: agentTag
projects: [project-slug]
tags: [relevant, tags]
---

# Descriptive Title

Constraint, discovery, or lesson.

## Workaround
How to avoid or handle it.

## Related
- [[other-discovery]]
```

Rules:
- Each discovery gets its own file
- Add a matching entry to `INDEX.md`
- Include a workaround whenever the note describes a constraint
- Include where proof lives when useful, such as a session, ticket, PR, host, path, or project memory entry.

### `~/.llm-party/agents/{{agentTag}}.md`

```markdown
# {{agentName}} Self Memory

DATE | PROJECT PATH | RULE | EXAMPLE
```

Rules:
- One file per agent, named `{{agentTag}}.md`
- Append-only
- Write corrections and validated non-obvious approaches immediately

