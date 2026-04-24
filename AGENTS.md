# AGENTS.md — PhenoHandbook

## Project Overview

- **Name**: PhenoHandbook (Engineering Handbook)
- **Description**: Engineering handbook with guidelines, anti-patterns, and best practices for Phenotype ecosystem
- **Location**: `/Users/kooshapari/CodeProjects/Phenotype/repos/PhenoHandbook`
- **Language Stack**: Markdown, MkDocs, Python
- **Published**: Public (GitHub Pages)

## Quick Start

```bash
# Navigate to project
cd /Users/kooshapari/CodeProjects/Phenotype/repos/PhenoHandbook

# Install dependencies
pip install -r requirements.txt

# Serve locally
mkdocs serve

# Build
mkdocs build
```

## Architecture

### Handbook Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                     MkDocs Site                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                    Navigation                                   │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐         │ │
│  │  │ Guidelines │  │ Anti-      │  │ Checklists │         │ │
│  │  │            │  │ Patterns   │  │            │         │ │
│  │  └────────────┘  └────────────┘  └────────────┘         │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐         │ │
│  │  │ ADRs       │  │ Methods    │  │ Playbooks  │         │ │
│  │  │            │  │            │  │            │         │ │
│  │  └────────────┘  └────────────┘  └────────────┘         │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Quality Standards

### Documentation Quality

- **Linter**: markdownlint
- **Spell Check**: cspell
- **Links**: markdown-link-check
- **Vale**: Prose linting

## Git Workflow

### Branch Naming

Format: `<type>/<section>/<description>`

Examples:
- `content/guidelines/add-code-review`
- `fix/adr/update-decision-status`
- `style/format/all-markdown`

## CLI Commands

```bash
# Development
mkdocs serve

# Build
mkdocs build

# Deploy
mkdocs gh-deploy
```

## Resources

- [MkDocs](https://www.mkdocs.org/)
- [Material Theme](https://squidfunk.github.io/mkdocs-material/)
- [Phenotype Registry](https://github.com/KooshaPari/phenotype-registry)

## Agent Notes

**Critical Details:**
- Handbook is reference material
- ADRs linked from decisions
- Keep guidelines actionable
- Update with codebase changes
