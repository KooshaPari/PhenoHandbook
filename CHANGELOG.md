# Changelog

All notable changes to `PhenoHandbook` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `AGENTS.md` — project identity, what/when/when-not for AI agents (ADR-023 substrate placement, ADR-024 71-pillar).
- `llms.txt` — LLM-friendly content discovery index per [llmstxt.org](https://llmstxt.org/); curated plain-text file at project root.
- `CHANGELOG.md` — re-authored to Keep a Changelog 1.1.0 skeleton (this file).

### Changed
- `AGENTS.md` — replaced 25-line stub (Phenotype repository / Quick Links) with a 1-page meta-bundle entry: What / When to use / When NOT to use / Layout / Conventions / Authority.

## [0.1.0] - 2026-04-30

### Added
- Initial release of `PhenoHandbook` — see `SPEC.md` § 1 (Executive Summary) for the one-line purpose ("living documentation for design patterns, anti-patterns, guidelines, methodologies, and checklists").
- `patterns/` — design patterns by domain (auth, async, caching, CI, observability, …).
- `anti-patterns/` — retired patterns with rationale (`language-bucket-sdk`, `mirror-to-empty-repo`).
- `adrs/` — MADR-format Architecture Decision Records (001-hexagonal-architecture through 008-security, plus more).
- `methodologies/`, `guidelines/`, `checklists/` — referenced from `README.md` Registry Structure (deferred content; subdirectories may be added in a future minor release).
- `mkdocs.yml` + `package.json` — MkDocs / VitePress site build configuration.
- `CHARTER.md` — mission, tenets (Living Documentation, Evidence-Based, Cross-Project Consistency, Accessible to All Levels, Implementation Agnostic, Community Contribution).
- Triple license: `LICENSE` + `LICENSE-MIT` + `LICENSE-APACHE`.
- `Taskfile.yml` — task runner config (lint, build, test, deploy).
- `vitest.config.ts` + `playwright.config.ts` — test runners.
- `pre-commit-config.yaml` + `.editorconfig` + `.gitattributes` — contributor hygiene.

## [Historical]

The content below was preserved verbatim from the pre-meta-bundle `CHANGELOG.md` (2026-04-30). It is the legacy "📚 Documentation / ✨ Features / 🔨 Other" grouping. It does not follow Keep a Changelog 1.1.0 grouping; entries are listed in reverse-chronological order by commit SHA. New entries MUST go under `[Unreleased]` and the proper section headers above.

### 📚 Documentation
- Docs: add README/SPEC/PLAN (`b0b31dd`)

### ✨ Features
- Feat: add 8 new patterns - JWT, API Keys, Circuit Breaker, Retry, BDD, Health Checks, Graceful Degradation + 3 ADRs (`986fcc5`)
- Feat: add comprehensive patterns - CQRS, Outbox, OAuth-PKCE, Cache-Aside, Saga, Event-Driven (`5f6b9ef`)

### 🔨 Other
- Chore(governance): adopt CLAUDE.md + governance framework

  Enable AgilePlus spec tracking, FR traceability, and standard project conventions. Wave-5 governance push.
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> (`8c1ad29`)
- Test(ts): wire vitest runner for smoke test (`02a7304`)
- Test(smoke): seed minimal smoke test — proves harness works (`fc4bbd9`)
- Chore(ci): adopt phenotype-tooling quality-gate + fr-coverage (`445ea4a`)
- Ci(legacy-enforcement): add legacy tooling anti-pattern gate (WARN mode)

  Adds legacy-tooling-gate.yml monitoring per CLAUDE.md Technology Adoption Philosophy.
  Refs: phenotype/repos/tooling/legacy-enforcement/ (`099f151`)
- Chore: add untracked patterns/specs (`669fa17`)
- Initial commit: PhenoHandbook patterns and guidelines registry (`28200d4`)
