---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax. Use when working with .md files in Obsidian, or when the user mentions wikilinks, callouts, frontmatter, tags, embeds, or Obsidian notes.
---

# Obsidian Flavored Markdown Skill

Create and edit valid Obsidian Flavored Markdown. Obsidian extends standard Markdown with wikilinks, embeds, callouts, properties, comments, tags, and highlight syntax. Obsidian also supports standard Markdown, LaTeX math, and Mermaid diagrams.

## Workflow: Creating an Obsidian Note

1. **Add frontmatter** with properties like `title`, `tags`, `aliases`, and `cssclasses` at the top of the file.
2. **Write content** using standard Markdown plus the Obsidian-specific syntax below.
3. **Use wikilinks** for vault notes and Markdown links for external URLs.
4. **Use embeds and callouts** where needed, then verify the note renders correctly in reading view.

> When choosing between wikilinks and Markdown links: use `[[wikilinks]]` for notes within the vault (Obsidian tracks renames automatically) and `[text](url)` for external URLs only.

## Internal Links (Wikilinks)

```markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
[[#Heading in same note]]
```

Define a block ID by appending `^block-id` to a paragraph, or put it on a new line after a list or quote:

```markdown
This paragraph can be linked to. ^my-block-id
 
> A quote block

^quote-id
```

## Embeds

Prefix any wikilink with `!` to embed its content inline:

```markdown
![[Note Name]]
![[Note Name#Heading]]
![[Note Name#^block-id]]

![[image.png]]
![[image.png|300]]
![[image.png|640x480]]

![[document.pdf]]
![[document.pdf#page=3]]
![[document.pdf#height=400]]

![[audio.mp3]]
![[video.mp4]]

![Alt text](https://example.com/image.png)
![Alt text|300](https://example.com/image.png)

```query
tag:#project status:done
```
```

Block embed rule: add a block ID like `^block-id` after a paragraph, list, or quote, then embed it with `![[Note#^block-id]]`.

## Callouts

```markdown
> [!note]
> Basic callout.

> [!warning] Custom Title
> Callout with a custom title.

> [!faq]- Closed by default
> Hidden until expanded.

> [!faq]+ Open by default
> Visible but collapsible.

> [!question] Outer callout
> > [!note] Inner callout
> > Nested content
```

Callout types CSV: `note,abstract,info,todo,tip,success,question,warning,failure,danger,bug,example,quote`

## Properties (Frontmatter)

```yaml
---
title: My Note Title
date: 2024-01-15
tags:
  - project
  - important
aliases:
  - My Note
cssclasses:
  - custom-class
status: in-progress
rating: 4.5
completed: false
due: 2024-02-01T14:30:00
related: "[[Other Note]]"
---
```

Property types CSV: `text,number,checkbox,date,datetime,list,link`

Default properties: `tags`, `aliases`, `cssclasses`

## Tags

```markdown
#tag                    Inline tag
#nested/tag             Nested tag with hierarchy
```

Tags can be inline or frontmatter-based. Use letters, numbers after the first character, underscores, hyphens, and forward slashes.

## Comments

```markdown
This is visible %%but this is hidden%% text.

%%
This entire block is hidden in reading view.
%%
```

## Obsidian-Specific Formatting

```markdown
==Highlighted text==                   Highlight syntax
```

## Also Supported

- Standard Markdown for headings, lists, tables, quotes, code blocks, and links.
- LaTeX math in inline `$...$` or block `$$...$$` form.
- Mermaid diagrams in fenced `mermaid` code blocks.
