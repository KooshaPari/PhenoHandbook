# CI Templates

These files are **documentation templates**, not active GitHub Actions workflows
for this repo. They are reference recipes fleet-wide — each says
"Copy the workflow below to your repo as `.github/workflows/<name>.yml`".

They live here (and not in `.github/workflows/`) because GitHub parses every
file in `.github/workflows/` as an active workflow. The original location caused
**failing CI checks on `main`** (the file looked like a workflow to GitHub but
had no parseable `on:`/jobs structure at the top level).

## Files

| File                    | Audience                                                                     | Status                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ratchet.md`            | App/service repos that want a quality ratchet (coverage / lint / complexity) | Reference only — PhenoHandbook is a doc spine, no ratchet applies here. |
| `sbom.md`               | Any repo releasing build artifacts (CycloneDX + Syft)                        | Reference only — PhenoHandbook has no release artifacts.                |
| `release-attest.md`     | Any repo publishing to GitHub Releases (build provenance via SLSA)           | Reference only — PhenoHandbook has no release artifacts.                |
| `verify-attestation.md` | Any repo consuming release artifacts (gh attestation verify on PR)           | Reference only — PhenoHandbook consumes no release artifacts.           |

## How to use

1. Open the relevant `.md` file in this directory.
2. Copy the fenced YAML block.
3. Paste into your repo at `.github/workflows/<name>.yml`.
4. Customize the install / matrix steps for your stack.
5. Commit, push, watch the check light up.

## Why not `.github/workflows/`?

`PhenoHandbook` is a **doc spine** (MkDocs/VitePress content, no runtime code,
no release artifacts). The four checks above are designed for runtime repos
that produce or consume build artifacts. Wiring them here would be busywork —
and historically was harmful: GitHub Actions parsed the templates and ran them
as if they were real workflows, producing red checks with zero useful jobs.

The fleet spine AGENTS.md classification for this repo:

> **Bucket:** spine (not a pheno-_-lib / phenotype-_-sdk / federated service per ADR-023)

That is the structural reason these checks live in `docs/ci-templates/` and
not in `.github/workflows/`.
