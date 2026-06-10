# Workspace Organization Pattern

## Overview

The Phenotype codebase is **not a git monorepo**. It is a flat directory of independently-versioned git repositories, all sitting as siblings under `repos/`, each with its own `.git`, its own CI, its own release tags, and its own AGENTS.md. This page is the single source of truth for that layout. It consolidates the "where does this crate / service / spec live" rule that is otherwise implicit in the `repos/` directory listing, in the per-repo `AGENTS.md` files, and across the git worktree convention that hangs each repo's branch lifecycle off a sibling `<repo>-wtrees/` directory.

If a pattern, ADR, or onboarding doc needs to point at a repo by path, it links here. If a new repo is added without a sibling `-wtrees/` directory, a `deny.toml` baseline, and a row in `phenotype-registry/ECOSYSTEM_MAP.md`, either fix the onboarding or update this page — don't fork the rule.

> **Scope note.** This page covers the *physical workspace layout* — which directory a repo lives in, which git owns it, where its worktrees go. The *role* a repo plays in the 4-role spine (INDEX / ADRs / CONVENTIONS / ENFORCEMENT) is the subject of [spine-roles](spine-roles.md). A repo is a workspace citizen (this page) before it has a spine role (that page); a workspace citizen without a role is fine for tooling / experiments, a spine role without workspace citizenship is not.

## The Rule

| Context | Layout | Git | Why |
|---------|--------|-----|-----|
| A first-class Phenotype repo (a long-lived service, library, contract, spec, handbook, registry, or governance bundle) | Sibling directory directly under `repos/`, named with the canonical `Pheno*` / `pheno*` (or spine-recognised) prefix. **Not** nested inside another repo. **Not** a subdirectory of a `monorepo/`, `packages/`, or `services/` umbrella. | The repo owns its own `.git/` and its own remote (`https://github.com/KooshaPari/<name>.git`). No super-project `git submodule add`; no composite `git-repo` parent. | One repo = one remote = one CI surface = one release tag. Nesting a repo inside another turns releases, branch hygiene, and CODEOWNERS into a coordination problem the org doesn't pay for. |
| A short-lived worktree of an existing first-class repo (a feature branch, an experiment, a per-worker scratch tree) | Sibling directory `<repo>-wtrees/<topic>/` next to the canonical `<repo>/`. The worktree is added with `git worktree add ../<repo>-wtrees/<topic> -b <topic> <base>` against the repo's own `.git`. | Shares the source repo's `.git` (worktree pointer) — no separate remote, no separate history. | Worktrees live in a sibling directory of the repo, not inside it. The `<repo>/.gitignore` cannot accidentally ignore them; the `<repo>/Cargo.toml` / `go.mod` cannot accidentally re-resolve them; the IDE opens the right tree by directory, not by branch guess. |
| A short-lived experimental clone (a "what if we tried this" PoC, a vendor import, an unproven idea) | Sibling directory `repos/<Name>-2nd/`, `<Name>-3rd/`, …, or `repos/<Name>-t1-<n>/` for a numbered test lane. Each clone has its own `.git`, its own working tree, and its own branch. | Independent `.git`. May be discarded wholesale when the experiment ends. | The numbered sibling convention is the org's "I need a parallel universe of this repo, but I don't want to fight the canonical one to get it" escape hatch. The dash + ordinal suffix is the contract: it's a clone, not a fork, not a submodule, and it's expected to be `rm -rf`'d when the lane closes. |
| A first-class repo's vendored external dependency (e.g. `phenoShared`'s `phenotype-logging` crate, an OpenAPI stub, a vendored protobuf) | Lives **inside** the consuming repo (e.g. `phenoShared/crates/`, `pheno/crates/`, `phenoShared/contracts/`). | Tracked in the consuming repo's own `.git`. May be a `path = "../sibling"` workspace member when the consumer is Rust. | Vendored code is part of the consumer's release; it ships in the consumer's tag. Promoting it to a top-level `repos/` sibling is a *promotion* event (separate decision, separate ADR, separate CI), not a workspace-organization detail. |

Two consequences:

- **Never** create a Pheno* repo as a subdirectory of another repo. `repos/pheno/services/PhenoMCP/` is wrong; `repos/PhenoMCP/` is right. The "service inside a monorepo" shape is rejected on sight at onboarding; if you need it, file an ADR proposing a workspace promotion instead.
- **Never** share a single `.git` across two top-level `repos/` siblings (other than via a worktree, which is *not* a sibling — it lives under `<repo>-wtrees/`). If two directories have the same `.git`, one of them is a worktree and the rest of the workspace will treat it as one.

## Canonical Structure

```
repos/                                                  ← the Phenotype workspace root
├── AGENTS.md                                           ← the workspace-level agent contract
├── CLAUDE.md                                           ← the workspace-level agent contract (Claude variant)
├── pheno/                                              ← the Rust core (56-crate cargo workspace) + Go services
│   ├── .git/                                           ← owns its own history
│   ├── .gitmodules                                     ← vendored external submodules (rare; prefer path = deps)
│   ├── Cargo.toml                                      ← the [workspace] table
│   ├── crates/                                         ← 56 Rust workspace members
│   ├── services/                                       ← Go backend services
│   ├── apps/                                           ← iOS / desktop / CLI front-ends
│   ├── docs/                                           ← the published site source
│   ├── docs-site/                                      ← VitePress build target
│   ├── deny.toml                                       ← cargo-deny baseline (mirrors the org's license/ban list)
│   ├── clippy.toml
│   └── rust-toolchain.toml
├── pheno-wtrees/                                       ← worktrees of pheno/, never a separate repo
│   └── <topic>/                                        ← added with `git worktree add ../pheno-wtrees/<topic> -b <topic> main`
├── phenoShared/                                        ← the "nine primitives" library repo
│   ├── .git/
│   └── crates/
│       ├── phenotype-logging/                          ← the canonical init_tracing helper
│       ├── phenotype-error-core/                       ← the canonical report(&err) helper
│       ├── phenotype-http-client/
│       ├── phenotype-config/
│       ├── phenotype-secrets/
│       ├── phenotype-rate-limit/
│       ├── phenotype-retry/
│       ├── phenotype-time/
│       └── phenotype-build-info/
├── phenoShared-wtrees/
├── PhenoMCP/                                           ← the canonical MCP server (the cheap-llm gateway)
│   ├── .git/
│   └── ...
├── PhenoMCP-wtrees/
├── PhenoMCP-1st/, PhenoMCP-2nd/, PhenoMCP-cheap/        ← experimental clones (the -1st/-2nd lane convention)
├── PhenoAgent/                                         ← the agent runtime repo
│   ├── .git/
│   └── ...
├── PhenoAgent-wtrees/
├── PhenoKits/                                          ← the kit / scaffold registry
├── PhenoKits-wtrees/
├── PhenoRuntime/                                       ← the runtime infra adapters (NATS, MinIO, etc.)
├── PhenoRuntime-wtrees/
├── PhenoSpecs/                                         ← the spine's ADRs / contracts / specs role
│   ├── .git/
│   └── adrs/                                           ← canonical home for ADRs
├── PhenoSpecs-wtrees/
├── PhenoHandbook/                                      ← this repo — the CONVENTIONS role
│   ├── .git/
│   ├── patterns/                                       ← the canonical pattern docs
│   ├── docs/                                           ← VitePress input
│   └── ...
├── PhenoHandbook-wtrees/                               ← sibling directory that holds this branch's worktree
│   └── chore-phenohandbook-workspace-organization-pattern-20260608/
├── phenotype-registry/                                 ← the spine's INDEX role (ECOSYSTEM_MAP.md)
├── phenotype-org-governance/                           ← the spine's ENFORCEMENT role (deny.toml baseline, CI policy)
└── ...                                                 ← ~370 sibling repos in total at time of writing
```

Key invariants the diagram encodes:

1. **One `.git` per top-level repo.** Every first-class repo is its own git repository. The only exception is `<repo>-wtrees/<topic>/`, which is a worktree and shares the parent's `.git/worktrees/` machinery.
2. **Worktrees are siblings of their repo, never children.** A worktree on `repos/PhenoMCP/` lives at `repos/PhenoMCP-wtrees/<topic>/`, not at `repos/PhenoMCP/.worktrees/<topic>/`. This keeps the IDE / cargo / go from accidentally resolving the worktree as part of the canonical repo.
3. **Experimental clones are siblings with a `-Nth` or `-t1-N` suffix.** A clone is a full independent repo with its own `.git`. It is *not* a worktree, *not* a submodule, and *not* a `git-new-workdir` hack. When the experiment ends, delete the directory; the canonical repo is unaffected.
4. **No umbrella "monorepo" parent.** The `repos/` directory is *not itself* a git repository. It is a plain directory that the developer keeps on disk; the org governance that spans repos lives in `phenotype-org-governance/`, not in a parent `.gitmodules` file.

## Reference Layouts (2+ example repos)

| Repo | Path under `repos/` | Layout pattern it follows |
|------|---------------------|---------------------------|
| **pheno** | `repos/pheno/` | The "big Rust cargo workspace" layout: 56 crates under `crates/`, Go services under `services/`, iOS app under `apps/`, published site under `docs/` + `docs-site/`. Owns its own `.git`, its own `deny.toml` (mirrored from `phenotype-org-governance`), its own CI. The reference for "first-class Pheno* repo at full size." |
| **phenoShared** | `repos/phenoShared/` | The "library crate constellation" layout: a thin `Cargo.toml` workspace with one crate per primitive (logging, error-core, http-client, config, secrets, rate-limit, retry, time, build-info). Each primitive is a sibling directory `crates/<name>/`. The reference for "extract a primitive to its own crate at the second use" — see [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md). |
| **PhenoMCP** | `repos/PhenoMCP/` (and `PhenoMCP-1st/`, `PhenoMCP-2nd/`, `PhenoMCP-cheap/`) | The "single service + experiment lanes" layout. `PhenoMCP/` is the canonical MCP server. `PhenoMCP-1st/` and `PhenoMCP-2nd/` are the ordinal-suffixed experimental clones (the -1st was a Rust rewrite attempt, the -2nd was a Go rewrite attempt; both were `rm -rf`'d after the experiment). `PhenoMCP-cheap/` is a long-lived experimental clone for the cheap-LLM gateway variant. The reference for "how to add an experimental lane without forking." |
| **PhenoAgent** | `repos/PhenoAgent/` | The "agent runtime" layout: a single Rust binary with adapter crates. Owns its own `.git` and its own `-wtrees/` sibling. The reference for "service repo that also has a CLI binary in the same workspace" — every worker (codex, gemini, copilot) is a separate adapter crate, not a separate top-level repo. |
| **PhenoHandbook** | `repos/PhenoHandbook/` (this repo) | The "documentation-only" layout: a VitePress site under `docs/` + `docs-site/`, patterns under `patterns/`, AGENTS.md at the root, no runtime code. The reference for "a repo that ships markdown, not binaries." |

The "X repos follow this, Y repos follow that" picture, scoped to the current PR set:

- ✅ **pheno, PhenoMCP, PhenoAgent, PhenoRuntime, PhenoKits, PhenoSpecs, PhenoHandbook, phenoShared, phenoForge** — Each is a direct child of `repos/`, each owns its own `.git`, each has a sibling `<repo>-wtrees/` directory (when worktrees are in use).
- ✅ **PhenoMCP-1st, PhenoMCP-2nd, PhenoMCP-cheap** — Ordinal / named experimental clones. Independent `.git`, expected to be discarded. The convention is *visible* in the directory listing, not hidden behind a `git worktree` link.
- ⚠️ **phenotype-shared** — A historical alias for the `phenoShared` role, retained for back-compat with older tooling. Track deprecation in `phenotype-registry`; do not point new code at it.

## Anti-Patterns

- ❌ **Nesting a Pheno* repo inside another Pheno* repo.** `repos/pheno/services/PhenoMCP/` is rejected on sight. The "service inside a monorepo" shape duplicates git history, breaks `deny.toml` baselines (which are per-repo), and makes per-repo CI / branch protection impossible. If a service logically belongs to a bigger repo, the right answer is a workspace member (`crates/`, `services/`, `apps/`), not a sibling-subdirectory.
- ❌ **A `git submodule add` for a first-class Pheno* repo.** `repos/pheno/.gitmodules` pointing at `../PhenoMCP` is a workspace-organization violation. The submodule shape hides the fact that the inner repo has its own release lifecycle; contributors end up editing the wrong checkout; CI sees the submodule as "a pinned snapshot" and never tests the inner repo's trunk. Promote the inner repo to a top-level `repos/` sibling instead.
- ❌ **A worktree inside the canonical repo's directory.** `repos/PhenoMCP/.worktrees/feature-x/` is wrong. Cargo, Go, the IDE, and `git worktree list` all treat it as part of `PhenoMCP` proper, and the worktree will accidentally be picked up by tools that scan the repo. Worktrees must live at `repos/PhenoMCP-wtrees/<topic>/` so the parent repo's tree is clean.
- ❌ **Two `repos/<name>` siblings sharing a `.git`.** If `repos/PhenoMCP/` and `repos/PhenoMCP-extra/` both have a `.git/` that resolves to the same on-disk gitdir, one of them is a worktree in disguise and the rest of the workspace will be confused. Use `<repo>-wtrees/<topic>/` for worktrees, `<repo>-Nth/` for clones, and never let the two collide.
- ❌ **`repos/` itself being a git repo.** A `.git/` at the workspace root would turn "add a new top-level repo" into a `git submodule add` temptation, and would mean *every* tool that walks the workspace has to handle a nested-git case. The workspace is a directory, not a repo. Repo-ness starts one level down.
- ❌ **Renaming a `repos/<name>` directory to fit a new shape without an ADR.** `pheno` is `pheno`, not `phenotype-core` and not `pheno-monorepo`. If a rename is warranted, file the ADR in `PhenoSpecs/adrs/`, update `phenotype-registry/ECOSYSTEM_MAP.md`, and migrate references. Don't `mv repos/pheno repos/phenotype-core` and call it a day.

## Related Patterns

- [spine-roles](spine-roles.md) — Once a repo is a workspace citizen (this page), it can take a role in the 4-role spine (INDEX / ADRs / CONVENTIONS / ENFORCEMENT). The two pages are layered: workspace first, role second.
- [delegation/codex-first](delegation/codex-first.md) — The "per-worker worktrees" rule depends on this page's `<repo>-wtrees/<topic>/` convention. If a worker creates a worktree at a different path, the worktree list becomes unsearchable and `git worktree list` returns garbage.
- [architecture/hexagonal](architecture/hexagonal.md) — The "ports are workspace-stable, adapters are repo-local" rule. Ports that get used by two repos graduate to `phenoShared`; adapters stay inside the consuming repo.
- [ci/never-billable-ci](ci/never-billable-ci.md) — Per-repo CI surfaces are a direct consequence of per-repo git: each repo gets its own billable minutes, its own runner pool, and its own cache. Sharing a `.git` would force CI to share all three.

## References

- `phenotype-registry/ECOSYSTEM_MAP.md` — The canonical list of which repo lives where, in spine order. Update this page and the registry's `ECOSYSTEM_MAP.md` together; the registry is authoritative for "what exists," this page is authoritative for "where it sits on disk."
- [`git worktree` documentation](https://git-scm.com/docs/git-worktree) — The primitive this page's `<repo>-wtrees/<topic>/` convention is built on. The man page is short; read it once before adding a worktree.
- `repos/<repo>/AGENTS.md` — Each first-class repo has its own `AGENTS.md` extending the workspace `AGENTS.md`. The workspace contract is the floor; the per-repo contract is the specifics.
- Internal: `phenotype-org-governance/deny.toml` — The license / ban baseline that each first-class repo mirrors into its own `deny.toml`. Workspace organization is what makes "each repo has its own `deny.toml`" tractable — without the per-repo layout, the baseline would have to be a single shared config, and we couldn't tighten it per-repo as we learn.
