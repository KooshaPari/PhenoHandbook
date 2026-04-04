# PhenoHandbook

**Patterns, anti-patterns, guidelines, and best practices for the Phenotype ecosystem.**

## Quick Start

<div class="grid">
  <div class="feature">
    <h3><a href="/patterns/">📐 Patterns</a></h3>
    <p>Proven solutions for common problems. Hexagonal architecture, event-driven systems, caching strategies, and more.</p>
  </div>
  <div class="feature">
    <h3><a href="/anti-patterns/">🚫 Anti-Patterns</a></h3>
    <p>Common mistakes and how to avoid them. Learn from the pitfalls others have encountered.</p>
  </div>
  <div class="feature">
    <h3><a href="/guidelines/">📋 Guidelines</a></h3>
    <p>Coding standards, review criteria, and best practices for consistent, high-quality code.</p>
  </div>
  <div class="feature">
    <h3><a href="/checklists/">✅ Checklists</a></h3>
    <p>Pre-flight checklists for deployment, security reviews, performance testing, and more.</p>
  </div>
  <div class="feature">
    <h3><a href="/methodologies/">🧭 Methodologies</a></h3>
    <p>TDD, BDD, DDD, and the ADR process. Structured approaches to software development.</p>
  </div>
  <div class="feature">
    <h3><a href="https://github.com/KooshaPari/PhenoSpecs">📚 Specs</a></h3>
    <p>Design specifications and architecture decision records (ADRs) in the PhenoSpecs registry.</p>
  </div>
</div>

## What is PhenoHandbook?

PhenoHandbook is the **living documentation** for the Phenotype ecosystem. Unlike static documentation that becomes stale, this handbook evolves with the codebase.

### Key Principles

- **Living**: Updated alongside code changes
- **Connected**: Links to [PhenoSpecs](https://github.com/KooshaPari/PhenoSpecs) specifications and [HexaKit](https://github.com/KooshaPari/HexaKit) templates
- **Actionable**: Code examples in Rust, Go, Python, and TypeScript
- **Reviewed**: All patterns have been battle-tested in production

## Phenotype Architecture

All Phenotype components follow **Hexagonal Architecture** (Ports and Adapters):

```
┌─────────────────────────────────────────┐
│           Application Layer             │
│  ┌─────────────────────────────────┐  │
│  │         Domain Layer              │  │
│  │    (Zero external dependencies)   │  │
│  └─────────────────────────────────┘  │
│           │                 │           │
│    ┌──────┘                 └──────┐   │
│    ▼                               ▼   │
│ ┌─────────┐                  ┌────────┐│
│ │ Ports   │                  │ Ports  ││
│ │(Inbound)│                  │(Out)   ││
│ └────┬────┘                  └────┬───┘│
│      │                          │    │
│ ┌────▼────┐                  ┌────▼───┐│
│ │Adapters│                  │Adapters││
│ └────────┘                  └────────┘│
└─────────────────────────────────────────┘
```

## Contributing

This handbook is **community-driven**. To add or update content:

1. Check the [contribution guidelines](./guidelines/)
2. Submit a PR to [KooshaPari/PhenoHandbook](https://github.com/KooshaPari/PhenoHandbook)
3. Link related specs from [PhenoSpecs](https://github.com/KooshaPari/PhenoSpecs)

---

**Part of the [Phenotype Registry System](https://github.com/KooshaPari/phenotype-registry)**
