# SOTA Research / Dependency Survey Pattern

**Status:** adopted · **Applies to:** every Pheno\* codebase that owns a major dependency category (HTTP, CLI, async, MCP, git, TUI, storage, etc.).

## Overview

Every Pheno\* repo that introduces, replaces, or *depends on* a major third-party category — HTTP servers, CLI argument parsers, async runtimes, MCP SDKs, git libraries, TUI frameworks, key/value stores, message buses, observability stacks — must carry a **`docs/sota-*-2026.md`** (or `docs/research/sota-*-2026.md` when the repo's docs subtree uses a `research/` prefix) that records the state-of-the-art for that category as it stood on the date the survey was performed, with a concrete recommendation mapped back to the in-tree code. This page is the canonical place that rule lives; it consolidates the "do the research, write it down, link the file with line numbers" guidance that was previously implicit in the `PhenoHandbook/SOTA.md` monolith (an early 2118-line survey), the per-repo `docs/MCP-CATALOG.md` research style, and the `Research date:` headers on the wave-4/5 SOTA docs. The default is a per-category Markdown file because a repo that picks `clap 4.6.x` over `argh 0.1.19` should be able to cite, in code review, the file and line number where the trade-off was studied, not a 2000-line omnibus.

If a repo is added, edited, or vendored, and that repo owns a non-trivial dependency surface (the threshold below), the work is incomplete without a `docs/sota-*-2026.md` for each major category. If a new category is adopted (`eBPF`, `OpenTelemetry SDKs`, `WebAuthn`, `vector DBs`), the diff is incomplete without a new SOTA file scoped to that category — don't append a section to an existing one, and don't write a "future work" stub. The SOTA file is the *evidence* the org uses to defend the choice; the recommendation table inside it is the *contract* the next migration is measured against.

This rule was rolled out org-wide in **waves 4 and 5** (June 2026) across four Pheno\* repos, each addressing a different dependency category. PhenoHandbook catches up after, in the order the org actually does the work.

## The Rule

| Context | Use | Default | Why |
|---------|-----|---------|-----|
| Every Pheno\* repo whose root, or a `crates/*` / `services/*` / `apps/*` subtree, depends on a non-trivial third-party category (HTTP framework, CLI parser, async runtime, MCP SDK, git library, TUI framework, KV store, message bus, observability SDK, auth provider, serialization format) | `docs/sota-<category>-2026.md` (or `docs/research/sota-<category>-2026.md` when the repo's docs already use a `research/` prefix, as in `PhenoRuntime`) | One file per category, dated `YYYY` for the survey year | One category, one canonical survey. A repo that has "researched" HTTP servers, CLI parsers, async runtimes, and git libraries, but only ships the HTTP write-up, is missing three categories — the SOTA file is per-category, not per-repo, and the absence of one for a category the repo depends on is a hygiene violation. |
| The filename slug | `<lang-or-tool>-<category>-<YYYY>.md` — e.g. `sota-rust-mcp-2026.md`, `sota-rust-cli-2026.md`, `sota-rust-tui-2026.md`, `sota-rust-async-2026.md`, `sota-rust-git-2026.md`, `sota-go-http-2026.md` | Lowercase, hyphenated, year-suffixed | The slug is a stable identifier across waves. Renaming `sota-rust-cli-2026.md` to `cli-research-2026.md` breaks the org's link graph (AgilePlus stories, GitHub cross-references, the registry's research index). The year suffix is a hard requirement — a `sota-rust-cli.md` without a year is an evergreen file masquerading as a snapshot, and the snapshot is the point. |
| The opening block | `**Date:** YYYY-MM-DD` (or `Research date:` / `Survey date:` in the wave-4/5 style) + the category in the H1 (`# SOTA: <Category> in <Year>`) + a one-paragraph scope statement naming the in-tree code being audited | — | A SOTA file without a date is a blog post. A SOTA file without a code-level scope statement is a literature review. Both are out of scope; the file must be auditable on the date it claims and traceable to the lines of code it informs. |
| The body | TL;DR → per-option table or sub-section → code-level recommendation with `path:line` references → references | TL;DR is mandatory; code-level recommendation is mandatory; references are mandatory | The TL;DR is the entrypoint for a reviewer who is about to merge a PR that touches the dependency. The per-option table is the audit trail. The code-level recommendation is the actionable conclusion — the file is *not* complete if it ends with "more research needed" or "we'll revisit in six months." |
| The first 1–2 sentences of the recommendation section | Name the current version being recommended, the current version the in-tree code uses, and the migration path (if any) | — | The org's SOTA docs are *living* documents only in the sense that the next wave writes a new file; the existing one stays at the date and version it captured. A reviewer reading `sota-rust-cli-2026.md` in 2027 should be able to see exactly what the recommendation was on the date of the survey, and the diff against the in-tree version should be visible from the file alone. |
| The number of SOTA files per repo | One per **major** dependency category. HTTP framework = one. Async runtime = one. CLI parser + progress + prompts + diagnostics = one umbrella file (the HeliosLab `sota-rust-cli-2026.md` is the canonical example). MCP SDK = one. Git library = one. TUI framework = one. | Per category, not per crate | A repo that has `sota-rust-tokio-2026.md`, `sota-rust-tracing-2026.md`, `sota-rust-serde-2026.md`, and `sota-rust-anyhow-2026.md` has *over*-researched the dependency surface and buried the actionable conclusions. The HeliosLab CLI survey is the right shape: one file, six rows in the recommendation table, six short sub-sections. |

**Hard rule:** A Pheno\* repo that depends on a major third-party category and has no `docs/sota-<category>-2026.md` (or `docs/research/sota-<category>-2026.md`) is a hygiene violation. The SOTA file is the *evidence* the org uses to defend a dependency choice in code review, in security review, and in a future "why are we still on `clap 4.6`" thread on Slack. A repo that picked `clap` because "everyone uses clap" is a repo that has not done the work the pattern demands. The default behavior is to write the SOTA file at the same time the dependency is introduced; the retroactive path is a follow-up PR scoped to the missing category.

**Hard rule:** A SOTA file that does not name a current version (e.g. "`clap` 4.6.1") and the in-tree version (`pheno-cli/Cargo.toml:17`) is a hygiene violation. The whole point of the survey is to be able to look at the file and know, on the date of the survey, what the recommended version was and what the code was on. A SOTA file that says "use the latest stable" is not a SOTA file — it is a copy-paste of the crate's README. The `clap 4.6.x`, `ratatui 0.30.x`, `tokio 1.52.x`, `gix 0.84.0`, `Go 1.22 ServeMux` style is the org's reference.

**Hard rule:** A SOTA file that does not end with a code-level recommendation is a hygiene violation. A SOTA file that ends with "more research needed" or "defer to a future wave" is a stub, not a SOTA file. The recommendation may be "no change required, current in-tree choice is correct" — that is a *valid* recommendation and the file is still complete. The rule is that the recommendation *exists* and is *named*, not that the recommendation is *migration*.

**Hard rule:** A SOTA file that is not committed on its own branch (`docs/<repo>-sota-<category>-<YYYYMMDD>` in the wave-4/5 style — see the Reference table below) is a hygiene violation. The branch name is the linkage between the survey and the PR that delivers it; a SOTA file merged to `main` directly with no branch is a SOTA file that cannot be rolled back per-category, cannot be cited by branch-name from a downstream PR, and cannot be linked from the registry's research index. The wave-4/5 branch naming is the org's reference.

## Canonical Pattern

### A wave-4/5-style `docs/sota-<category>-2026.md` for a Rust crate

```markdown
# SOTA: Rust <Category> in 2026

**Date:** 2026-06-09
**Subject:** <Repo> — alignment check against current state-of-the-art (SOTA)
**Baseline (June 2026):** <language toolchain version>; <key ecosystem version>.

This document summarizes web research into the current SOTA for <category>
in <language> and maps those findings against <Repo>'s existing
`<path/to/in-tree/code>` implementation. The goal is to identify which
patterns <Repo> already gets right, where it is dated, and what a future
modernization PR should consider.

## 1. <Sub-category A>: <option 1> vs <option 2> vs <option 3>

| Library | Latest | <axis 1> | <axis 2> | Notes |
| --- | --- | --- | --- | --- |
| <option 1> | <version> | <value> | <value> | <one-line> |
| <option 2> | <version> | <value> | <value> | <one-line> |
| <option 3> | <version> | <value> | <value> | <one-line> |

**2026 SOTA consensus:** For new projects, the *<option 1>* is generally
recommended first because <one-sentence reason>. <option 2> remains the
right answer when <condition>. <option 3> is preferred only when
<condition>.

## 2. <Sub-category B>: <axis>

- <finding 1 with `path/to/file.rs:line` reference>
- <finding 2 with `path/to/file.rs:line` reference>
- <finding 3 with `path/to/file.rs:line` reference>

## N. Recommendation for <Repo>

<Repo> today uses `<crate>` `<current-version>` (see `<path/to/manifest>:N-M`).
That is the <correct|dated|outdated> 2026 choice. <One-paragraph rationale
that names the in-tree code by path and line, names the recommended
version, and names the migration path (or "no migration required").>

When <Repo> does need to <migrate|adopt|upgrade>, the move is:

1. **<Step 1 with version pin and feature flags>**. This gives <reason>.
2. **<Step 2 with code-level detail>**. <Reason>.
3. **Defer <step 3>** to a follow-up: <reason>.

## Decision matrix

| If you need… | Choose | Why |
|--------------|--------|-----|
| <use case A> | `<option 1>` | <reason> |
| <use case B> | `<option 2>` | <reason> |
| <use case C> | `<option 3>` | <reason> |

## References

- <Official docs URL>
- <Repo URL>
- <Authoritative blog post or RFC>
- <Crate download/stars/metrics page, dated>
- <Adjacent PhenoHandbook pattern or PhenoSpecs ADR>
```

### Conventions (lifted from the wave-4/5 SOTA docs)

- The opening block names the date, the subject (the in-tree code being audited), and the language/category baseline. The PhenoRuntime `sota-rust-async-2026.md` opens with "Adds `docs/research/sota-rust-async-2026.md` covering the current state of the Rust async ecosystem in June 2026" — the commit message and the file's first paragraph are the same statement. A SOTA file whose opening block is a generic "this document surveys X" is a SOTA file that has not been pinned to a date and a subject.
- The per-option comparison is a **table**, not prose. The PhenoMCP `sota-rust-mcp-2026.md`, the HeliosLab `sota-rust-cli-2026.md`, the PhenoRuntime `sota-rust-async-2026.md`, and the KWatch `sota-go-http-2026.md` all use a table for the side-by-side. Prose comparisons are harder to scan in code review; tables are the org's reference.
- The code-level recommendation section is the *last* numbered section before the decision matrix and references. It is the only section that names the in-tree code by path and line. The HeliosLab `sota-rust-cli-2026.md:62-75` ("Recommendation for HeliosLab") is the canonical example: it names `pheno-cli/src/tui.rs` and `pheno-cli/Cargo.toml:17-18` and gives a one-paragraph "this is correct, no migration" recommendation.
- The decision matrix at the end is the *contract*. A reviewer who wants to know "should we add `rust-mcp-sdk` for OAuth" reads the matrix row "Streamable HTTP with OAuth, Tasks, Axum out of box → `rust-mcp-sdk`" and gets the answer in one line. The matrix is the part of the file that gets re-read most often; it should be the cleanest table in the repo.
- The references section is the *audit trail*. URLs are preferred over "the ecosystem has moved on" assertions. The HeliosLab `sota-rust-tui-2026.md` and the PhenoMCP `sota-rust-mcp-2026.md` both end with explicit "Ratatui website" and "rmcp on crates.io" links; a SOTA file without external links is a SOTA file whose research cannot be reproduced.
- A SOTA file is *not* a migration plan. Migration plans are PRs with code diffs; SOTA files are surveys with recommendations. The PhenoHandbook pattern is "survey first, PR second" — a PR that introduces a new dependency without a SOTA file is a PR that is missing its evidence; a SOTA file that contains a code diff is a SOTA file that has overstepped its scope.
- A SOTA file is *not* an ADR. ADRs are org-level decisions and live in `PhenoSpecs/adrs/`; SOTA files are repo-level surveys and live in the repo's `docs/` (or `docs/research/`). The split is the [4-role spine](spine-roles.md) — PhenoHandbook is **CONVENTIONS** (this page), PhenoSpecs is **ADRs/contracts/specs** (decisions), and a SOTA file is the *evidence* a future ADR would cite, not the ADR itself.

## Reference: the wave-4/5 rollout

| Repo | File | Branch | Category | Lines | Notes |
|------|------|--------|----------|-------|-------|
| **HeliosLab** | `docs/sota-rust-cli-2026.md` | `docs/helioslab-sota-rust-cli-20260608` (commit `72862d4`) | Rust CLI ecosystem (arg parsers, progress, prompts, diagnostics) | 200 lines | Research snapshot 2026-06-09. Covers `clap 4.6.x` vs `argh 0.1.19` vs `lexopt 0.3.2`, `indicatif 0.18.x`, `dialoguer 0.12.x`, `miette 7.6.x`. Maps the analysis back to `pheno-cli/` with line-level references. The recommendation table is the org's reference for "umbrella SOTA files" (one file, six rows, six sub-sections). |
| **PhenoMCP** | `docs/sota-rust-mcp-2026.md` | `docs/phenomcp-sota-rust-mcp-20260608` (merged to main) | Rust MCP SDK ecosystem (rmcp, rust-mcp-sdk, transports) | 91 lines | Research snapshot 2026-06-10. Covers the official `rmcp` (modelcontextprotocol/rust-sdk) and the third-party `rust-mcp-sdk` (rust-mcp-stack). Recommendation: adopt `rmcp` with `features = ["server", "transport-io", "macros", "schemars"]`, defer HTTP/OAuth to a follow-up. The file is the org's reference for "SOTA on a niche category where there is exactly one credible production option." |
| **PhenoRuntime** | `docs/research/sota-rust-async-2026.md` | `docs/phenoruntime-sota-rust-async-20260608` (commit `462fe9c`) | Rust async runtime ecosystem (Tokio, async-std, smol, tracing) | 162 lines | Research snapshot 2026-06-10. Covers Tokio 1.52.x (May 2026), async-std discontinuation, smol as the lightweight alternative, tracing 0.1.x. Maps back to the `pheno-runtime` adapter crates (`pheno-nats`, `phenotype-llm`, `phenotype-mcp-server`, `phenotype-surrealdb`, `pheno-minio`). The file lives in `docs/research/` (the `research/` prefix is the PhenoRuntime convention); the org's rule is that the prefix is allowed when the repo's docs subtree already uses one, not introduced ad hoc. |
| **KWatch** | `docs/sota-go-http-2026.md` | `docs/kwatch-sota-go-http-20260608` (commit `af81003`) | Go HTTP server patterns (router, hardening, graceful shutdown) | 173 lines | Research snapshot 2026-06-09. Covers chi v5 vs gin v1.12 vs echo v5 vs stdlib `net/http` (Go 1.22 enhanced `ServeMux`). Maps the analysis back to `server/server.go` and identifies misalignments: missing `ReadHeaderTimeout`, no recoverer middleware, no body-size limit on `POST /run`, `log.Printf` instead of `slog`, no `signal.NotifyContext`. The file is the org's reference for "SOTA that ends in a misalignment list" — the recommendation is "stdlib `net/http` is correct; modernize the four missing timeouts and adopt `slog`." |
| **PhenoVCS** | `docs/sota-rust-git-2026.md` | `docs/phenovcs-sota-rust-git-20260608` (commit `a59974b`) | Rust git library ecosystem (git2, gix, git-repository) | 120 lines | Research snapshot 2026-06-10. Covers `gix 0.84.0` (Jan 2026) vs `git2` (libgit2 bindings). Maps the analysis back to `crates/worktree-manager/src/worktree_manager/infrastructure/git_adapter.rs` and recommends the migration triggers for moving from the `Command::new(git)` subprocess adapter to a `gix`-based `GixWorktreeAdapter` behind the existing `WorktreeRepository` port. The file is the org's reference for "SOTA on a category with a clear long-term winner (`gix`) but a valid short-term subprocess-based adapter." |
| **HeliosLab** (prior wave) | `docs/sota-rust-tui-2026.md` | (merged to main) | Rust TUI library ecosystem (Ratatui, Cursive, tui-rs) | 83 lines | Research snapshot 2026-06-10. Covers `ratatui 0.30.x`, `cursive 0.21.1`, and the deprecated `tui-rs`. Recommendation: keep `ratatui 0.29 + crossterm 0.28` in `pheno-cli/src/tui.rs`; consider bumping to `0.30.x` for the modular workspace split. The file is the org's reference for "SOTA on a category where the choice is already correct" — the recommendation is "no migration required," which is a *valid* SOTA outcome. |
| **PhenoHandbook** | (this page) | (this page documents the pattern; the wave-4/5 rollout is tracked here) | — | — | The handbook documents the rule; the rule is enforced repo-by-repo, not centrally. The five SOTA files in this table are the org's reference set; a new SOTA file in a new repo is added as a new row. |

The line counts come from `git show --stat` on each branch's tip commit. A wave-4/5 SOTA file is **83–200 lines** — long enough to name the alternatives and the recommendation, short enough to read in a code review without scrolling. A SOTA file over 500 lines is over-researched; a SOTA file under 50 lines is a stub. The HeliosLab `sota-rust-cli-2026.md` (200 lines) is the upper bound; the HeliosLab `sota-rust-tui-2026.md` (83 lines) is the lower bound.

## Anti-Patterns

- ❌ A Pheno\* repo that owns a major dependency category with no `docs/sota-<category>-2026.md` — the choice was made without evidence, and a future review or migration has no audit trail. Add the file; retro is acceptable, but the file must be dated at the date of the survey, not back-dated to the date of the original commit.
- ❌ A SOTA file with no date in the opening block — a SOTA file is a snapshot, and a snapshot without a timestamp is a blog post. Pin the date in the H1 or the first paragraph; the wave-4/5 style is `**Date:** YYYY-MM-DD` or `**Research date:** YYYY-MM-DD`.
- ❌ A SOTA file with no in-tree code reference — a SOTA file that surveys the ecosystem without naming the lines of code it informs is a literature review. The HeliosLab `sota-rust-cli-2026.md:62-75` ("Recommendation for HeliosLab") names `pheno-cli/src/tui.rs` and `pheno-cli/Cargo.toml:17-18`; that is the org's reference. A SOTA file that says "applies to the repo generally" is not a SOTA file.
- ❌ A SOTA file with no decision matrix — a SOTA file that ends with prose is a SOTA file whose recommendations cannot be re-read quickly. The decision matrix is the part of the file that gets re-read most often; it should be the cleanest table in the repo. The PhenoMCP `sota-rust-mcp-2026.md:76-80` is the org's reference: 5 rows, "If you need X → choose Y because Z."
- ❌ A SOTA file that contains a code diff — a SOTA file is a survey, not a migration PR. The split is "survey first, PR second" — a PR that introduces a new dependency without a SOTA file is missing evidence; a SOTA file that contains the diff is overstepping its scope. The SOTA file's recommendation may be "adopt `rmcp` with `features = [...]`" (the PhenoMCP recommendation); the *actual adoption* is a follow-up PR.
- ❌ A SOTA file that is an ADR — ADRs are org-level decisions and live in `PhenoSpecs/adrs/`. SOTA files are repo-level surveys and live in the repo's `docs/` (or `docs/research/`). A SOTA file that says "Decision: we adopt `clap 4.6.x`" is overstepping into ADR territory; the right split is "Recommendation: `clap 4.6.x` is the 2026 SOTA" in the SOTA file, and a separate ADR (or no ADR, for a routine dep choice) in `PhenoSpecs/adrs/`.
- ❌ A SOTA file with a `<lang-or-tool>-<category>` slug but no year — a `sota-rust-cli.md` is an evergreen file masquerading as a snapshot. The year is the hard requirement; a future wave writes `sota-rust-cli-2027.md` and the 2026 file stays at 2026. The PhenoHandbook's own `SOTA.md` (an early 2118-line monolith) is the cautionary example: it was useful in 2026-04 but cannot be updated without rewriting a 2000-line file, and the per-category-per-year slug is the org's escape from that trap.
- ❌ A SOTA file merged to `main` directly with no branch — a SOTA file that is not on its own branch (`docs/<repo>-sota-<category>-<YYYYMMDD>` in the wave-4/5 style) cannot be rolled back per-category, cannot be cited by branch-name from a downstream PR, and cannot be linked from the registry's research index. The wave-4/5 branch naming is the org's reference; a future wave adopts the same convention.
- ❌ Multiple SOTA files per crate — a repo that has `sota-rust-tokio-2026.md`, `sota-rust-tracing-2026.md`, `sota-rust-serde-2026.md`, and `sota-rust-anyhow-2026.md` has *over*-researched the dependency surface. The HeliosLab `sota-rust-cli-2026.md` is the right shape: one file, six rows in the recommendation table, six short sub-sections. The threshold is *one file per major category*, not *one file per crate*.
- ❌ A SOTA file that hand-waves the in-tree version — a SOTA file that says "use the latest stable" instead of "`clap 4.6.1`" is a copy-paste of the crate's README. The whole point of the survey is to be able to look at the file and know, on the date of the survey, what the recommended version was and what the code was on. The `clap 4.6.x`, `ratatui 0.30.x`, `tokio 1.52.x`, `gix 0.84.0`, `Go 1.22 ServeMux` style is the org's reference.

## Migration Checklist (per repo / per category)

1. List every major dependency category the repo owns (HTTP framework, CLI parser, async runtime, MCP SDK, git library, TUI framework, KV store, message bus, observability SDK, auth provider, serialization format). Each category is in scope; the rule is per-category, not per-repo.
2. For each category, check whether a `docs/sota-<category>-2026.md` (or `docs/research/sota-<category>-2026.md` when the repo's docs already use the `research/` prefix) exists. If not, write one. The wave-4/5 SOTA files are the org's reference for the structure.
3. For each new SOTA file, use the wave-4/5 branch naming convention: `docs/<repo>-sota-<category>-<YYYYMMDD>`. The branch name is the linkage between the survey and the PR that delivers it.
4. For each SOTA file, include the opening block (date, subject, baseline), the per-option comparison table, the code-level recommendation with `path:line` references, the decision matrix, and the references section. The TL;DR is mandatory.
5. Verify with `wc -l docs/sota-<category>-2026.md` that the file is in the 50–500 line range. Under 50 is a stub; over 500 is over-researched. The wave-4/5 files are 83–200 lines; that is the org's reference range.
6. Verify with `grep -E 'Date|Research date|Survey date' docs/sota-<category>-2026.md` that the date is in the opening block. A SOTA file without a date is a blog post.
7. Verify with `grep -E 'Recommendation for|Decision matrix|If you need' docs/sota-<category>-2026.md` that the recommendation and decision matrix exist. A SOTA file without a recommendation is a stub.
8. Open a PR with a title that names the rule (`docs(<repo>): add SOTA research on <category> (<year>)` is the wave-4/5 wording). Reference the in-tree code in the PR body by path and line. Reference this pattern in the PR body.

## Related Patterns

- [spine-roles](spine-roles.md) — the 4-role split (index / ADRs / conventions / enforcement). A SOTA file is **CONVENTIONS-adjacent research** (PhenoHandbook is the conventions repo, and a SOTA file is the evidence a convention is built on); the SOTA file lives in the repo it surveys, *not* in PhenoHandbook. PhenoHandbook documents the *pattern* (this page); each repo carries its own *evidence* (the `docs/sota-*.md` files). The split is "pattern in PhenoHandbook, evidence in the repo."
- [build-verification](build-verification.md) — the same "wave-based rollout with a per-repo table" shape. The build-verification pattern documents the org-wide `timeout-minutes:` rollout in two waves (`PhenoDevOps` #206, `HeliosLab` `chore/helioslab-timeout-minutes-20260608`); the SOTA research pattern documents the wave-4/5 SOTA rollout across five Pheno\* repos. The two patterns share the structure: a hard rule, a canonical pattern, a per-wave reference table with commit hashes and line counts, anti-patterns, and a migration checklist.
- [ci/never-billable-ci](ci/never-billable-ci.md) — the sponsor-merge protocol path. A SOTA file is a docs-only PR and qualifies for the sponsor-merge path when the PR is green but blocked by required-review protection. The wave-4/5 SOTA branches (HeliosLab `sota-rust-cli`, PhenoRuntime `sota-rust-async`, KWatch `sota-go-http`, PhenoVCS `sota-rust-git`) all use this path because the patch is a single new file with no code surface.
- [delegation/codex-first](delegation/codex-first.md) — the worktree-per-worker rule. A SOTA research PR is a candidate for delegation: the research is fetch-based (web search + crate docs), the write-up is a single Markdown file, and the file is disjoint from any other file in the repo. The wave-4/5 SOTA files were all generated by a codex-spark worker on its own worktree, with the merge done by the orchestrator after the green CI run.
- [architecture/hexagonal](architecture/hexagonal.md) — the "wrapper over a third-party primitive" shape. A SOTA file is the *evidence* a wrapper is built on; the wrapper (e.g. `phenotype-time` wrapping `chrono`) is the *artifact*. The PhenoRuntime `sota-rust-async-2026.md` is the SOTA file that backs the `pheno-runtime` async wrapper; the HeliosLab `sota-rust-cli-2026.md` is the SOTA file that backs `pheno-cli`. The pattern is "SOTA first, wrapper second."

## References

- [PhenoHandbook/SOTA.md](https://github.com/phenotype-org/PhenoHandbook/blob/main/SOTA.md) — the org's original 2118-line SOTA monolith (April 2026). Useful as a *historical* reference and as a literature-review index; *not* the org's reference for SOTA file *structure*. The per-category-per-year slug is the org's escape from the 2000-line-monolith trap.
- [docs/sota-rust-cli-2026.md (HeliosLab, branch `docs/helioslab-sota-rust-cli-20260608`, commit `72862d4`)](https://github.com/phenotype-org/HeliosLab/blob/docs/helioslab-sota-rust-cli-20260608/docs/sota-rust-cli-2026.md) — the wave-4 reference for "umbrella SOTA file" (one file, six rows, six sub-sections, 200 lines).
- [docs/sota-rust-mcp-2026.md (PhenoMCP, merged to main)](https://github.com/phenotype-org/PhenoMCP/blob/main/docs/sota-rust-mcp-2026.md) — the wave-5 reference for "SOTA on a niche category with one credible production option" (`rmcp`).
- [docs/research/sota-rust-async-2026.md (PhenoRuntime, branch `docs/phenoruntime-sota-rust-async-20260608`, commit `462fe9c`)](https://github.com/phenotype-org/PhenoRuntime/blob/docs/phenoruntime-sota-rust-async-20260608/docs/research/sota-rust-async-2026.md) — the wave-5 reference for "SOTA in `docs/research/`" (the `research/` prefix is the PhenoRuntime convention; the org's rule is that the prefix is allowed when the repo's docs subtree already uses one).
- [docs/sota-go-http-2026.md (KWatch, branch `docs/kwatch-sota-go-http-20260608`, commit `af81003`)](https://github.com/phenotype-org/KWatch/blob/docs/kwatch-sota-go-http-20260608/docs/sota-go-http-2026.md) — the wave-4 reference for "SOTA that ends in a misalignment list" (stdlib `net/http` is correct; modernize the four missing timeouts and adopt `slog`).
- [docs/sota-rust-git-2026.md (PhenoVCS, branch `docs/phenovcs-sota-rust-git-20260608`, commit `a59974b`)](https://github.com/phenotype-org/PhenoVCS/blob/docs/phenovcs-sota-rust-git-20260608/docs/sota-rust-git-2026.md) — the wave-4 reference for "SOTA on a category with a clear long-term winner (`gix`) but a valid short-term subprocess-based adapter."
- [docs/sota-rust-tui-2026.md (HeliosLab, merged to main)](https://github.com/phenotype-org/HeliosLab/blob/main/docs/sota-rust-tui-2026.md) — the wave-3 reference for "SOTA on a category where the choice is already correct" (the recommendation is "no migration required," which is a valid SOTA outcome).
- Internal: PhenoHandbook `patterns/build-verification.md` — the "wave-based rollout with a per-repo table" template. The build-verification table (PhenoDevOps #206, HeliosLab, PhenoHandbook) and the SOTA-research table above share the same structure: branch name, commit hash, file count, line count, and a one-line note on the wave's distinguishing feature. The two patterns are the org's reference for "a pattern page that documents a rollout."
