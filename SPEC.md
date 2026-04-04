# SPEC: PhenoHandbook — Patterns & Guidelines Registry

## Meta

- **ID**: phenohandbook-001
- **Title**: PhenoHandbook Specification — Design Patterns & Best Practices
- **Created**: 2026-04-04
- **State**: specified
- **Version**: 1.0.0
- **Language**: Markdown (MkDocs)

---

## Overview

PhenoHandbook is the living documentation for design patterns, anti-patterns, guidelines, and best practices in the Phenotype ecosystem. It serves as the central knowledge base for building software the "Phenotype way" — consumed by developers and indexed by automated tooling.

---

## ASCII Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PhenoHandbook Architecture                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────┐    │
│   │                         Content Sources                             │    │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │    │
│   │  │   patterns/  │  │ anti-patterns/│  │ guidelines/  │                │    │
│   │  │              │  │              │  │              │                │    │
│   │  │ • auth/      │  │ • security/  │  │ • style/     │                │    │
│   │  │ • caching/   │  │ • performance│  │ • review/    │                │    │
│   │  │ • async/     │  │ • api/       │  │ • workflow/  │                │    │
│   │  │ • database/  │  │ • testing/   │  │              │                │    │
│   │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │    │
│   └─────────┼─────────────────┼─────────────────┼────────────────────────┘    │
│             │                 │                 │                              │
│   ┌─────────┴─────────────────┴─────────────────┴─────────────────────────────┐│
│   │                            Indexing Layer                                    ││
│   │  ┌─────────────────────────────────────────────────────────────────────┐    ││
│   │  │              Registry Index (registry.yaml)                            │    ││
│   │  │                                                                      │    ││
│   │  │   Pattern ID → File path → Tags → Related specs → Code examples       │    ││
│   │  │   PATTERN-AUTH-001 → patterns/auth/oauth-pkce.md                      │    ││
│   │  └─────────────────────────────────────────────────────────────────────┘    ││
│   └─────────────────────────────────┬───────────────────────────────────────────┘│
│                                     │                                           │
│   ┌─────────────────────────────────┴───────────────────────────────────────────┐│
│   │                          Publication Layer (MkDocs)                          ││
│   │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐       ││
│   │  │  Markdown       │  │  mkdocs.yml     │  │  GitHub Pages           │       ││
│   │  │  sources        │  │  (config)       │  │  (deployment)           │       ││
│   │  │                 │  │                 │  │                         │       ││
│   │  │ • Syntax: GFM   │  │ • Theme: Material│  │ • Auto-deploy            │       ││
│   │  │ • Frontmatter   │  │ • Plugins       │  │ • PR previews            │       ││
│   │  │ • Code blocks   │  │ • Search        │  │ • Versioning             │       ││
│   │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘       ││
│   └───────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                         Consumer Interfaces                                  │   │
│   │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐      │   │
│   │  │  Web (Human)    │  │  CLI (Developer)│  │  API (Agent/Tooling)    │      │   │
│   │  │                 │  │                 │  │                         │      │   │
│   │  │ handbook.pheno  │  │ pheno handbook  │  │ /api/patterns           │      │   │
│   │  │ type.dev        │  │   search        │  │ /api/anti-patterns      │      │   │
│   │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘      │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Components Table

| Component | Path | Language | Responsibility | Status |
|-----------|------|----------|----------------|--------|
| **Patterns** | `patterns/` | Markdown | Design patterns by domain | Active |
| **Anti-patterns** | `anti-patterns/` | Markdown | Common mistakes to avoid | Active |
| **Guidelines** | `guidelines/` | Markdown | Coding standards | Active |
| **Methodologies** | `methodologies/` | Markdown | Development workflows (TDD, BDD, DDD) | Active |
| **Checklists** | `checklists/` | Markdown | Verification lists | Active |
| **Site Config** | `mkdocs.yml` | YAML | MkDocs configuration | Active |

---

## Data Models

### Pattern Document
```yaml
---
id: PATTERN-AUTH-001
title: OAuth PKCE Flow
domain: auth
tags: [oauth, pkce, security, mobile]
related_specs: [SPEC-AUTH-001, SPEC-SSO-002]
created: 2024-01-15
updated: 2024-03-20
---

# OAuth PKCE Flow

## Summary
Secure OAuth flow for mobile and SPA applications.

## Problem
Authorization code flow exposes client secret in mobile apps.

## Solution
Use PKCE (Proof Key for Code Exchange) extension.

## Example
```typescript
// Code verifier generation
const verifier = generateCodeVerifier();
const challenge = await generateCodeChallenge(verifier);
```

## When to Use
- Mobile applications
- Single-page applications (SPAs)
- Public clients

## When NOT to Use
- Confidential server-side clients
- When refresh tokens aren't supported

## Related Patterns
- [Token Refresh](./token-refresh.md)
- SPEC-AUTH-002

## References
- RFC 7636
- ADR-012
```

### Registry Entry
```yaml
# registry.yaml
patterns:
  auth:
    oauth-pkce:
      id: PATTERN-AUTH-001
      path: patterns/auth/oauth-pkce.md
      tags: [oauth, pkce, security]
      implementations:
        - repo: phenotype-auth-ts
          path: src/oauth/
      status: stable
```

---

## Pattern Categories

| Category | Description | Count |
|----------|-------------|-------|
| **auth** | Authentication & authorization patterns | 15+ |
| **caching** | Caching strategies and patterns | 10+ |
| **async** | Asynchronous programming patterns | 8+ |
| **database** | Data access patterns | 12+ |
| **observability** | Logging, metrics, tracing patterns | 10+ |
| **api** | API design patterns | 15+ |
| **testing** | Testing patterns and strategies | 12+ |

---

## xDD Methodologies

| Methodology | When to Use | Pattern Location |
|-------------|-------------|------------------|
| TDD | Unit-level logic | `methodologies/tdd-workflow.md` |
| BDD | Feature scenarios | `methodologies/bdd-workflow.md` |
| DDD | Complex domains | `methodologies/ddd-workflow.md` |
| SDD | Spec-first projects | `methodologies/sdd-workflow.md` |
| FDD | Feature-centric work | `methodologies/fdd-workflow.md` |
| CDD | API contracts | `methodologies/cdd-workflow.md` |
| AI-DD | AI-assisted coding | `methodologies/ai-dd-workflow.md` |

---

## Dependencies

| Category | Tool | Purpose |
|----------|------|---------|
| **Site Generator** | MkDocs | Static site generation |
| **Theme** | Material for MkDocs | Documentation theme |
| **Plugins** | search, minify, git-revision-date | Enhanced features |
| **Validation** | markdownlint | Markdown linting |
| **CI/CD** | GitHub Actions | Auto-deployment |

---

## Workspace Structure

```
PhenoHandbook/
├── patterns/                  # Design patterns
│   ├── auth/
│   ├── caching/
│   ├── async/
│   ├── database/
│   └── ...
├── anti-patterns/             # What NOT to do
│   ├── security/
│   ├── performance/
│   └── ...
├── guidelines/                # Coding standards
│   ├── style/
│   ├── review/
│   └── workflow/
├── methodologies/             # Development workflows
│   ├── tdd-workflow.md
│   ├── bdd-workflow.md
│   └── ...
├── checklists/                # Verification lists
│   ├── deployment.md
│   └── security.md
├── docs/                      # Additional docs
├── mkdocs.yml                 # Site configuration
├── registry.yaml              # Pattern index
└── README.md
```

---

## References

1. [MkDocs](https://www.mkdocs.org/) — Documentation site generator
2. [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) — Theme
3. [Architecture Decision Records](https://adr.github.io/) — ADR format
4. [PhenoSpecs](https://github.com/KooshaPari/PhenoSpecs) — Related spec registry

---

*Generated: 2026-04-04*
