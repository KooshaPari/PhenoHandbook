# Parallel Execution: Worktree-per-Subagent

**Status:** adopted · **Applies to:** any org-level fan-out where N subagents (codex-spark, Composer, native Claude, etc.) work disjoint slices of the same repo in parallel, with the goal of landing N PRs against `main` in one wave.

## Overview

When a task DAG fans out to multiple subagents against a single repository, the org's default execution model is **worktree-per-subagent**: each subagent is given its own `git worktree` rooted at its own branch, the subagent commits atomically inside that worktree, and the branches are merged into `main` only after every subagent in the wave has reported success. This page is the canonical place that rule lives; it consolidates the disjoint-files + per-worker-worktree guidance that was previously implicit in [delegation/codex-first](delegation/codex-first.md) and the parallel-execution shape that the 100-task DAG actually runs at.

If a DAG node is fanned out to more than one subagent and the org reverts to a shared-branch model ("they'll all just commit to `chore/wave-x` and we'll resolve conflicts at the end"), the diff is incomplete without this page. The shared-branch model is the violation; the worktree-per-subagent model is the rule.

The pattern was first executed end-to-end against the 100-task DAG (`DAG_100.md` / `FLEET_100TASK_DAG*.md` at the monorepo root), where the org ran tens of subagents against dozens of repos in a single wave, each on its own branch, and landed the wave via a single sponsor-merge pass once every subagent had reported.

## The Rule

| Context | Use | Default | Why |
|---------|-----|---------|-----|
| A DAG node fanned out to N > 1 subagents against a single repo | **One `git worktree` per subagent, each rooted at a unique branch.** Branches are merged into `main` only after every subagent in the wave has reported success. | 1 worktree + 1 branch per subagent | The shared-branch model forces live conflict resolution. With N subagents racing on the same branch, the second-to-commit subagent's `git push` rejects, the third-to-commit subagent's `git rebase` collides with the second's, and the orchestrator spends the wall-clock budget on a serialization problem the worktree model eliminates. One worktree per subagent is the *only* shape that scales past ~3 parallel workers on disjoint files. |
| A single subagent's commit on its worktree | **Atomic.** One logical change = one commit. No `WIP`, no fixup squashed later, no "I'll rebase before push." | 1 commit per logical change | A subagent's commit is the unit of review and the unit of revert. A `WIP` commit is unreviewable; a fixup commit is a rebase trap when the sponsor-merge pass picks the branch up. The commit message is the contract; the worktree is the sandbox; the branch is the delivery vehicle. |
| A subagent's branch name | **`chore/<repo>-<purpose>-<date>`.** The repo slug is the owner; the purpose is a short kebab-case verb phrase; the date is `YYYYMMDD`. | `chore/<repo>-<purpose>-<YYYYMMDD>` | Branch names are the audit trail. A sponsor-merge pass over a 100-task DAG needs to know which repo a branch belongs to (so it can target the right remote), what the branch is for (so it can pick up the right PR template), and when the branch was cut (so stale branches can be culled). The convention encodes all three. |
| Merge into `main` | **Only after all subagents in the wave have reported success.** No partial-merge. No "merge the green ones and retry the red ones in a second wave." | post-wave, single pass | A wave is a batch. Merging the green subagents before the red subagents finish means the red subagents rebase against a `main` that has already moved, which is the live-conflict shape the worktree model was designed to avoid. The wave's contract is "all green, then merge"; the orchestrator's job is to enforce it. |
| Cross-subagent file contention | **Disjoint files.** No two subagents in a wave may write to the same file. If a DAG node requires a shared file, that node is not fan-out-eligible — split it first. | disjoint-files-only | Two subagents writing the same file in parallel worktrees is unreconcilable without a serial hand-off, which defeats the parallelism. The DAG must split on a file-disjointness axis (or a directory-disjointness axis) before the wave starts. The worktree model assumes the DAG node has already been split. |

**Hard rule:** a wave with two subagents sharing a branch is a wave that will serialize at the first non-trivial conflict. The worktree-per-subagent model is the wrapper; the disjoint-files split in the DAG is the precondition. Skip the split, the wrapper breaks.

**Hard rule:** a subagent that commits `WIP` or `fixup!` is a subagent that has not finished its task. The orchestrator must reject the branch, the subagent must recommit atomically, and the wave's "all green" gate must not flip until every branch in the wave is at a single atomic commit. The atomicity rule is the one the sponsor-merge pass relies on; relax it and the pass becomes a rebase-and-resolve exercise.

**Hard rule:** the wave's branches do not push to `origin` until the orchestrator has green from every subagent. A premature `git push -u origin chore/<repo>-<purpose>-<date>` is a race that surfaces in CI before the wave is complete; CI is a per-branch signal, and a half-wave CI result is not a usable signal. Push happens at the end, once, in batch.

**Hard rule:** a worktree is bound to a branch for the duration of the wave. A subagent that needs to "switch tasks mid-wave" closes its worktree, abandons its branch, and is re-fanned-out as a new node with a new branch. Mid-wave branch-switching is the worktree-model's most common violation; the rule is one worktree, one branch, one task, one wave.

## Canonical Pattern

### The branch name

```
chore/<repo>-<purpose>-<date>
```

- `<repo>` is the org's slug for the target repo (e.g. `phenohandbook`, `phenodevops`, `helioslab`, `agentmcp`, `authkit`). Lowercase, no separator, no `.git` suffix.
- `<purpose>` is a short kebab-case verb phrase that names the work the branch carries (e.g. `parallel-execution-pattern`, `timeout-minutes`, `codex-first-adoption`). Two to four words; the branch's commit log and PR title will repeat the same phrase.
- `<date>` is `YYYYMMDD`, the day the branch was cut. The date is the freshness signal; the org's branch-cull policy runs against it.

Examples from the rollout waves:

- `chore/phenohandbook-parallel-execution-pattern-20260608` — the branch that produced this page.
- `chore/helioslab-timeout-minutes-20260608` — the second `timeout-minutes:` rollout wave, lifted from [ci/build-verification](build-verification.md).
- `chore/phenodevops-timeout-minutes` (variation: date omitted on the PhenoDevOps wave, which predated the date-suffix convention; the convention is now mandatory).

### The wave lifecycle

```
         ┌──────────────────────────────────────────────────────────────┐
         │                                                              │
   1.    │  DAG node fanned out: N subagents, disjoint-file split,       │
   plan  │  orchestrator pre-creates N worktrees and N branches          │
         │  (`chore/<repo>-<purpose>-<date>` per subagent).              │
         │                                                              │
         ├──────────────────────────────────────────────────────────────┤
         │                                                              │
   2.    │  Subagent i runs in worktree i: edits disjoint files,        │
   work  │  commits atomically (no WIP, no fixup), reports green/red.   │
         │  No pushes to origin. No switching branches.                 │
         │                                                              │
         ├──────────────────────────────────────────────────────────────┤
         │                                                              │
   3.    │  Orchestrator waits for every subagent's green.              │
   gate  │  Red subagents re-run (new worktree, new branch) — the       │
         │  failed branch is abandoned, not amended.                    │
         │                                                              │
         ├──────────────────────────────────────────────────────────────┤
         │                                                              │
   4.    │  Orchestrator pushes every branch to origin in a batch,      │
   push  │  opens N PRs (or sponsors N PRs if a single orchestrator     │
         │  is also the integrator), CI runs per-branch.                │
         │                                                              │
         ├──────────────────────────────────────────────────────────────┤
         │                                                              │
   5.    │  Sponsor-merge pass: every PR with green CI is merged        │
   land  │  into main in the order the DAG specifies. No partial-merge. │
         │  Failed CI is re-run as a new wave (new branch, new date).   │
         │                                                              │
         └──────────────────────────────────────────────────────────────┘
```

### A subagent's worktree (the per-worker view)

```bash
# Orchestrator side: pre-create the worktree + branch
git worktree add ../<repo>-<purpose>-<date> -b chore/<repo>-<purpose>-<date> main

# Subagent side: work inside the worktree, no other context
cd ../<repo>-<purpose>-<date>
# … edits, atomic commits …
git add <disjoint-file-set>
git commit -m "<purpose>: <one-line summary>"
# report green to orchestrator; do NOT git push.
```

### The orchestrator's push-and-PR pass

```bash
# After every subagent is green:
for branch in $(git branch --list 'chore/<repo>-*' --format='%(refname:short)'); do
  git push -u origin "$branch"
done

# One PR per branch, explicit flags (never interactive):
for branch in $(git branch --list 'chore/<repo>-*' --format='%(refname:short)'); do
  gh pr create \
    -R KooshaPari/<repo> \
    -H "$branch" \
    -B main \
    --title "chore(<repo>): <purpose> (wave <date>)" \
    --body  "Wave: <date>. Subagent: <agent-id>. Atomic commit: <sha>. See patterns/parallel-execution.md."
done
```

Conventions (lifted from the 100-task DAG wave):

- **One worktree per subagent, pre-created by the orchestrator.** The subagent never creates its own worktree; the subagent is handed a worktree path and a branch name and works inside them. The orchestrator owns the worktree lifecycle (create, hand-off, cleanup-on-abandon).
- **Atomic commits are non-negotiable.** A subagent's branch must end the wave at a single commit on top of `main`. Multi-commit branches are accepted only when the commits are independently reviewable (rare; the wave's contract is "one logical change = one commit"). Squashing mid-wave is the orchestrator's job, not the subagent's.
- **No `git stash`.** A subagent that finds itself mid-edit when the wave ends commits the WIP to its branch (with a `WIP:` prefix the orchestrator can grep for) and reports the result; the orchestrator decides whether to recommit, abandon, or re-fan-out. A `git stash` is a "lost work" trap the wave cannot afford; lift from [delegation/codex-first](delegation/codex-first.md#parallel-work-rules).
- **No `git push` from inside the subagent.** The subagent commits locally; the orchestrator pushes in a batch. Premature pushes surface in CI as a half-wave signal that is not actionable.
- **Disjoint files are a DAG invariant, not a runtime check.** The DAG node that fans out must already be split on a file-disjointness axis; the orchestrator does not validate disjointness at runtime (it cannot — by the time both subagents have committed, the conflict is already in the tree). The DAG's split is the contract.
- **Date suffix is the freshness signal.** A branch older than 14 days with no activity is auto-culled by the org's branch-prune job. The `YYYYMMDD` suffix makes the age calculation trivial.
- **Wave ID is the commit trailer.** Every subagent's atomic commit carries a `Wave-Id: <date>-<node>` trailer. The trailer is what the sponsor-merge pass uses to group PRs into waves for the audit log.

## Reference: the 100-task DAG wave

The pattern was first executed end-to-end against the 100-task DAG at the monorepo root (`DAG_100.md`, with v1/v2/merged variants under `FLEET_100TASK_DAG*.md`). The wave ran tens of subagents against dozens of Pheno\* repos in a single wave, each on its own `chore/<repo>-<purpose>-<date>` branch, and landed via a single sponsor-merge pass.

| DAG file | Scope | Subagents | Repos touched | Branch shape | Notes |
|----------|-------|-----------|---------------|--------------|-------|
| `DAG_100.md` | 100-node fleet DAG, org-wide fan-out | ~60 (varies by node) | ~40 (Pheno\* + Helios\* + Agent\*) | `chore/<repo>-<purpose>-<date>` per subagent | First end-to-end execution of the worktree-per-subagent model at org scale. Every subagent ran in its own worktree, committed atomically, and pushed in a single orchestrator-owned batch. The shape is the org's reference for any future fleet-scale wave. |
| `FLEET_100TASK_DAG.md` | v1 of the 100-task DAG (the original spec) | — | — | — | The plan file; precedes the merged variant. Read it to understand the DAG's *intent*; read the merged variant to understand the DAG as it was actually run. |
| `FLEET_100TASK_DAG_v2.md` | v2 of the 100-task DAG (post-first-wave revisions) | — | — | — | The v2 spec. Diff against `FLEET_100TASK_DAG.md` to see what the first wave taught the org about the wave-lifecycle steps above. |
| `FLEET_100TASK_DAG_V2_MERGED.md` | v2 merged into the live DAG state | — | — | — | The DAG as it was actually run. The audit-trail file: which subagents ran on which branches, which sponsor-merge pass landed which PRs, which subagents re-ran in a follow-up wave with new dates. The reference for the org's "how do we know a wave actually landed" answer. |

Operational notes from the wave:

- **Subagent worktree count peaked at ~60 in a single wave.** Git handles this comfortably; the bottleneck was the orchestrator's branch-creation step, not git's worktree table. Pre-creating all worktrees up front (the orchestrator does this in step 1 of the lifecycle) means the wave starts in seconds, not minutes.
- **The disjoint-files split was the wave's largest planning cost.** Splitting a 100-node DAG into ~60 subagents required ~40 of the 100 nodes to be broken on a file-disjointness axis first. The split was done by hand; the org's follow-up is a DAG-linter that flags fan-out nodes whose slices are not provably disjoint.
- **Sponsor-merge was the wave's largest wall-clock cost after CI.** The 60-branch sponsor-merge pass took longer than the subagents' cumulative work because every PR needed a CI run to green before the merge. The follow-up is per-branch CI pre-merge (run CI on the branch as soon as the subagent reports green, in parallel with the other branches' CI, then merge all greens in one pass).
- **Red subagents re-ran in a follow-up wave, not mid-wave.** The wave's contract held: no partial-merge, no mid-wave branch amends. The follow-up wave (a second `chore/<repo>-<purpose>-<date+1>` per failed subagent) ran after the first wave landed, with the same disjoint-files guarantee.
- **This page itself is a wave artifact.** `chore/phenohandbook-parallel-execution-pattern-20260608` is the branch that produced this page; it was cut by the orchestrator for the wave that landed the parallel-execution pattern across the PhenoHandbook repo, and is the canonical reference for the worktree-per-subagent model in the org's conventions spine.

## Anti-Patterns

- ❌ Two subagents sharing a branch — forces live conflict resolution, serializes the wave at the first non-trivial merge, and breaks the orchestrator's "all green, then merge" gate. Use one worktree per subagent, with the branch name encoded by the convention above.
- ❌ A subagent committing `WIP` or `fixup!` — unreviewable, un-revert-able, and a rebase trap for the sponsor-merge pass. The wave's contract is atomic commits; a `WIP` commit is a subagent that has not finished its task, and the orchestrator must reject the branch.
- ❌ A subagent `git push`-ing mid-wave — surfaces a half-wave CI result that is not actionable. The orchestrator owns the push; the subagent commits locally and reports green. Push happens once, in batch, after every subagent is green.
- ❌ A subagent switching branches mid-wave — the worktree-per-subagent model's most common violation. The rule is one worktree, one branch, one task, one wave. A subagent that needs to switch tasks closes its worktree, abandons its branch, and is re-fanned-out as a new node with a new branch (and a new date).
- ❌ A DAG node fanned out on a non-file-disjoint axis (two subagents editing different *sections* of the same file, two subagents adding rows to the same table, two subagents touching different crates in the same `Cargo.toml`) — unreconcilable in parallel; the worktree model assumes file-disjointness. Split the DAG node on a file-disjointness axis first, then fan out.
- ❌ Merging green subagents before red subagents finish — the red subagents then rebase against a `main` that has already moved, which is the live-conflict shape the worktree model was designed to avoid. The wave is a batch; the gate is "all green, then merge."
- ❌ A wave with no `Wave-Id:` trailer on the subagent commits — the sponsor-merge pass cannot group the PRs into a wave for the audit log, and the follow-up wave (the red-subagent retry) cannot correlate its branches with the first wave's branches. The trailer is the contract; commit-message lint enforces it.
- ❌ A branch without a `YYYYMMDD` date suffix — the org's branch-prune job cannot compute the branch's age, the wave's audit log cannot reconstruct the cut-order, and the sponsor-merge pass cannot sort the PRs into a "first wave" / "follow-up wave" sequence. The date is mandatory, not optional.
- ❌ `git stash` inside a subagent — a "lost work" trap the wave cannot afford. Lift from [delegation/codex-first](delegation/codex-first.md#parallel-work-rules): commit dirty work to the branch with a `WIP:` prefix, or keep working dirty. The orchestrator decides what to do with the WIP; the subagent does not lose it.
- ❌ The orchestrator creating a worktree *after* handing the task to the subagent — the subagent starts work in the wrong directory, the orchestrator's "pre-create" step is skipped, and the wave's audit log cannot reconstruct which worktree the subagent ran in. The orchestrator creates the worktree; the subagent receives the path.
- ❌ A worktree-per-subagent wave that "almost worked" being patched up with a shared-branch follow-up — the worktree model is all-or-nothing per wave. A patched-together wave with a mix of worktree-branches and shared-branches is unreviewable; either the wave ran on the worktree model (and landed atomically) or it did not (and the audit log flags it as a hygiene violation). Fix the wave, don't patch the result.

## Migration Checklist (per wave)

1. **Plan the disjoint-files split.** For every DAG node being fanned out, confirm the slices are file-disjoint. If a slice requires shared-file edits, split the DAG node first. The split is the precondition; the worktree model is the wrapper.
2. **Pre-create the worktrees and branches.** One `git worktree add` per subagent, with a unique `chore/<repo>-<purpose>-<date>` branch per worktree. Date is `YYYYMMDD`, the day the wave is cut. Do not skip this step; the subagent does not create its own worktree.
3. **Hand the subagent its worktree path and its branch name.** The subagent works inside the worktree, commits atomically, and reports green/red. No `git push`, no branch switching, no `WIP` commits, no `git stash`.
4. **Wait for every subagent's green.** Red subagents re-run in a follow-up wave (new worktree, new branch, new date) — the failed branch is abandoned, not amended. Do not merge the greens early.
5. **Push every branch in a batch, then open one PR per branch.** The orchestrator owns the push and the PR. Pass explicit flags to `gh pr create` so nothing blocks on a prompt. CI runs per-branch.
6. **Sponsor-merge in a single pass.** Every PR with green CI is merged into `main` in the order the DAG specifies. Failed CI is re-run as a new wave (new branch, new date). No partial-merge; the wave is a batch.
7. **Tag the wave in the audit log.** Every subagent's atomic commit carries a `Wave-Id: <date>-<node>` trailer; the sponsor-merge pass writes a wave-summary entry (subagent count, branch list, PR list, merge order) to the org's audit log. The summary is what the follow-up wave's audit log correlates against.
8. **Clean up the worktrees.** Once the wave is merged, the orchestrator removes the worktrees (`git worktree remove`) and prunes the worktree list (`git worktree prune`). The branches stay on `origin` (the date suffix makes them candidates for the org's 14-day auto-cull); the local worktrees do not.

## Related Patterns

- [delegation/codex-first](delegation/codex-first.md) — the channel-priority rule (codex-spark first, Composer sparingly, native Claude for judgment) and the "never `git stash`" guidance. The worktree-per-subagent model is the *shape* that codex-first's "disjoint files + per-worker worktrees" rule takes when the fan-out is org-scale.
- [delegation/codex-first — Parallel-work rules](delegation/codex-first.md#parallel-work-rules) — the disjoint-files rule, the per-worker-worktree rule, and the never-stash rule. This page is the *operationalization* of those three rules into a wave lifecycle.
- [ci/build-verification](build-verification.md) — the `timeout-minutes: 10` rule and the rollout-wave shape. The HeliosLab wave (`chore/helioslab-timeout-minutes-20260608`) is a single-subagent example of the `chore/<repo>-<purpose>-<date>` branch convention; this page extends that convention to N-subagent waves.
- [ci/never-billable-ci — Sponsor-merge protocol](ci/never-billable-ci.md#sponsor-merge-protocol) — the path for a PR that is green but blocked by required-review protection. The wave's "sponsor-merge in a single pass" step is the N-PR generalization of the single-PR sponsor-merge protocol.
- [spine-roles](spine-roles.md) — the 4-role split (index / ADRs / conventions / enforcement). This page is the *conventions* slice of the parallel-execution shape; the registry indexes the waves, PhenoSpecs would hold an ADR if the shape ever needs to change, and governance enforces the wave's audit log.

## References

- [`DAG_100.md`](../../DAG_100.md) — the 100-node fleet DAG at the monorepo root. The first end-to-end execution of the worktree-per-subagent model at org scale.
- [`FLEET_100TASK_DAG.md`](../../FLEET_100TASK_DAG.md) — v1 of the 100-task DAG (the original spec).
- [`FLEET_100TASK_DAG_v2.md`](../../FLEET_100TASK_DAG_v2.md) — v2 of the 100-task DAG (post-first-wave revisions).
- [`FLEET_100TASK_DAG_V2_MERGED.md`](../../FLEET_100TASK_DAG_V2_MERGED.md) — v2 merged into the live DAG state; the audit-trail file for the org's "how do we know a wave actually landed" answer.
- Internal: `chore/phenohandbook-parallel-execution-pattern-20260608` — the branch that produced this page. Cut by the orchestrator for the wave that landed the parallel-execution pattern across the PhenoHandbook repo, and the canonical reference for the worktree-per-subagent model in the org's conventions spine.
- Internal: `chore/helioslab-timeout-minutes-20260608` — the second `timeout-minutes:` rollout wave. A single-subagent example of the `chore/<repo>-<purpose>-<date>` branch convention; the convention is named in [ci/build-verification](build-verification.md) and generalized in this page.
