---
name: obsidian-markdown
description: Create valid Obsidian Markdown with frontmatter, wikilinks, embeds, callouts, and tags. Use when working with Obsidian notes, mind-map entries, or files that should render well inside an Obsidian vault.
---

# Obsidian Flavored Markdown Skill

Write normal Markdown plus the Obsidian features this project actually uses.

## Core Rules

1. Use frontmatter when the note needs structured properties.
2. Use `[[wikilinks]]` for vault notes.
3. Use Markdown links only for external URLs.
4. Keep Obsidian notes readable as plain Markdown too.

## Frontmatter

```yaml
---
title: Note Title
tags:
  - project
aliases:
  - Alternate Title
---
```

## Wikilinks

```markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
```

To link a block, add an ID such as `^block-id` after the paragraph or block.

## Embeds

```markdown
![[Note Name]]
![[Note Name#Heading]]
![[image.png|300]]
![[document.pdf#page=2]]
```

## Callouts

```markdown
> [!note]
> Basic callout.

> [!warning] Custom Title
> Important detail.
```

Common callouts: `note`, `info`, `tip`, `success`, `question`, `warning`, `danger`, `bug`.

## Tags and Formatting

```markdown
#tag
#nested/tag
==highlighted text==
```

## Also Supported

- Standard Markdown
- LaTeX math
- Mermaid diagrams
