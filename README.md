# PhenoHandbook

**Status:** maintenance

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Quality Gate](https://github.com/KooshaPari/PhenoHandbook/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/KooshaPari/PhenoHandbook/actions/workflows/quality-gate.yml)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6.svg)](https://www.typescriptlang.org)

Living documentation for design patterns, anti-patterns, guidelines, and best practices across the Phenotype ecosystem. Serves as the central knowledge base for how to build software the "Phenotype way" — from architecture decisions to CI/CD practices.

## Overview

PhenoHandbook is a community-driven patterns registry that captures collective knowledge about building resilient, scalable, and maintainable Phenotype applications. All patterns link to specifications in PhenoSpecs and inform template generation in HexaKit. The handbook is published as a searchable VitePress site and serves as reference material for code reviews and architecture discussions.

---

## Quick Start

```bash
# Browse patterns by domain
ls patterns/auth/                 # Auth patterns
ls patterns/caching/              # Caching patterns

# Read specific pattern
cat patterns/auth/oauth-pkce.md

# Check anti-patterns (what NOT to do)
cat anti-patterns/security/plaintext-tokens.md

# Follow a methodology
cat methodologies/tdd-workflow.md

# Use a checklist
cat checklists/deployment.md
```

---

## Registry Structure

| Directory | Purpose | Contents |
|-----------|---------|----------|
| `patterns/` | Design patterns by domain | Async, caching, auth, observability, etc. |
| `anti-patterns/` | What NOT to do | Common mistakes and their fixes |
| `guidelines/` | Coding standards | Style guides, review criteria, conventions |
| `methodologies/` | Development workflows | TDD, BDD, DDD, xDD patterns |
| `checklists/` | Verification lists | Pre-deployment, security, testing |
| `docs/.vitepress/config.mts` | Site config | For published documentation site |

---

## Pattern Format

Each pattern follows this structure:

```markdown
# Pattern Name

## Summary
One-sentence description.

## Problem
What problem does this solve?

## Solution
How to implement it.

## Example
```rust
// Good example
```

## When to Use
- When X happens
- When Y is needed

## When NOT to Use
- When Z applies

## Related Patterns
- [Related Pattern](./related.md)
- SPEC-AUTH-001 (links to spec)

## References
- Links to ADRs
- External resources
```

---

## Connection to Specs & Templates

Patterns in this handbook inform:

1. **Specs** in [PhenoSpecs](https://github.com/KooshaPari/PhenoSpecs) - Patterns become specs
2. **Templates** in [HexaKit](https://github.com/KooshaPari/HexaKit) - Patterns inform template structure
3. **Code** in all repos - Patterns guide implementation

---

## xDD Methodologies

From [xDD_METHODOLOGIES.md](https://github.com/KooshaPari/xDD_METHODOLOGIES.md):

| Methodology | When to Use |
|-------------|-------------|
| TDD | Unit-level logic |
| BDD | Feature scenarios |
| DDD | Complex domains |
| SDD | Spec-first projects |
| FDD | Feature-centric work |
| CDD | API contracts |
| AI-DD | AI-assisted coding |

See `methodologies/` for detailed workflows.

---

## Living Documentation

This handbook is published as a documentation site:

```bash
# Local preview
bun run docs:dev

# Build
bun run docs:build

# Deploy
git push origin main  # Auto-deploy via CI
```

---

## Contributing

1. **New pattern**: Create PR with pattern in appropriate domain folder
2. **Update pattern**: Edit + add changelog entry
3. **Anti-pattern**: Explain the problem + the fix
4. **Guideline**: Include rationale and examples

All contributions must link to relevant specs in PhenoSpecs.

---

## Technology Stack

- **Documentation**: Markdown with YAML frontmatter for metadata
- **Publishing**: VitePress
- **Search**: Built-in full-text search via VitePress
- **Version Control**: Git; versioning per pattern
- **CI/CD**: Auto-publish on push to main branch

## Key Features

- **Pattern-Driven**: 50+ design patterns organized by domain (auth, caching, async, observability, etc.)
- **Anti-Pattern Catalog**: Document what NOT to do with remediation guidance
- **Methodology Guides**: TDD, BDD, DDD, AI-DD workflows with step-by-step examples
- **Checklist Library**: Pre-deployment, security, performance verification lists
- **Spec Linking**: All patterns cross-reference PhenoSpecs for traceability
- **Code Examples**: Rust, Python, TypeScript examples for each pattern
- **Search**: Full-text search across all patterns and guidelines

## Related Phenotype Projects

- **[PhenoSpecs](../PhenoSpecs/)** — Formal specifications; patterns inform specs
- **[HexaKit](../HexaKit/)** — Code generation templates; uses handbook patterns for scaffolding
- **[AgilePlus](../AgilePlus/)** — Spec-driven work tracking; handbook linked in FR docs
- **[phenotype-infrakit](../phenotype-infrakit/)** — Infrastructure patterns documented here

## Governance & Contributing

- **CLAUDE.md** — Contribution guidelines and pattern standards
- **FUNCTIONAL_REQUIREMENTS.md** — Pattern catalog and coverage tracking
- **docs/PATTERN_TEMPLATE.md** — Standard pattern format
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

All new patterns must link to at least one functional requirement or specification.

## Links

- **[PhenoSpecs](https://github.com/KooshaPari/PhenoSpecs)** — Formal specifications and contracts
- **[HexaKit](https://github.com/KooshaPari/HexaKit)** — Project templates and scaffolding
- **[AgilePlus](https://github.com/KooshaPari/AgilePlus)** — Spec-driven development platform

## License

MIT — see [LICENSE](./LICENSE).
