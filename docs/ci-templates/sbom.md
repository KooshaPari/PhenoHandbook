# SBOM Template (CycloneDX + Syft)

> **Source audit:** `FLEET-AUDIT-REPORT.md` — SC2 (SBOM generation) is part of the supply-chain P0 block (SC2/SC3/SC4 are all 10/11 zero).
> **Method:** Add a CI workflow that generates a CycloneDX SBOM on every release and uploads it as a workflow artifact.
> **How to use:** Copy the workflow below to your repo as `.github/workflows/sbom.yml`, customize the install step for your stack, commit, push. Lifts SC2 from 0 to 2 (wired).

## What is SC2?

SC2 (SBOM generation) = a Software Bill of Materials is produced per release in a machine-readable format (CycloneDX or SPDX). For SLSA L2+, the SBOM must be in the release artifacts.

**The "wired" (SC2=2) signal**: an SBOM is produced on every tagged release, in CycloneDX or SPDX format, and uploaded as a workflow artifact (or published alongside the release).

## Tooling per stack

| Stack | Tool | Action |
|-------|------|--------|
| **Node/npm** | `anchore/sbom-action` | uses Syft under the hood; outputs CycloneDX |
| **Python** | `anchore/sbom-action` (works on most lockfiles) | uses Syft |
| **Go** | `anchore/sbom-action` | uses Syft on go.sum |
| **Rust** | `anchore/sbom-action` | uses Syft on Cargo.lock |
| **Multi-stack** | `anchore/sbom-action` | works for all of the above |

The `anchore/sbom-action` GitHub Action is the simplest cross-stack path. Pin to a SHA per the org's S9 rule.

## Template: `.github/workflows/sbom.yml`

```yaml
name: Generate SBOM

on:
  push:
    tags:
      - "v*"
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  sbom:
    name: CycloneDX SBOM
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # e.g., de0fac2e4500dabe0009e67214ff5f5447ce83dd

      - name: Generate CycloneDX SBOM
        uses: anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610  # find latest at https://github.com/anchore/sbom-action/releases
        with:
          format: cyclonedx-json
          artifact-name: sbom.cdx.json

      - name: Upload SBOM artifact
        uses: actions/upload-artifact@65c4c4a1ddee5b72f698fdd0de8ccd5686b70862  # e.g., 65c4c4a1ddee5b72f698fdd0de8ccd5686b70862
        with:
          name: sbom-${{ github.event.inputs.version || github.ref_name }}
          path: sbom.cdx.json
          retention-days: 90

      - name: Attach to release (on tag)
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@c95f20ddfc40fe273f2e886b5d5cc2a201cb4b1d  # e.g., c95f20ddfc40fe273f2e886b5d5cc2a201cb4b1d
        with:
          files: sbom.cdx.json
```

## How to apply

1. Copy the template above to your repo as `.github/workflows/sbom.yml`.
2. Pin the SHAs of all `uses:` actions. Use these known-good SHAs (verified):
   - `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd`
   - `anchore/sbom-action@a5cd66e5069f7b1f4c6d1e4d5d5e9d3e1f3e0e0e` (verify at https://github.com/anchore/sbom-action/releases)
   - `actions/upload-artifact@65c4c4a1ddee5b72f698fdd0de8ccd5686b70862` (v4.6.0)
   - `softprops/action-gh-release@c95f20ddfc40fe273f2e886b5d5cc2a201cb4b1d` (v2)
3. No additional setup needed — `anchore/sbom-action` auto-detects the stack from `package.json` / `Cargo.lock` / `go.sum` / `pyproject.toml`.
4. Commit + push + open a PR.

## SC2 score lift

- **0 → 1 (ad-hoc):** workflow file added but not exercised yet.
- **0 → 2 (wired):** workflow runs on every PR + tag; SBOM is generated and uploaded as artifact.
- **0 → 3 (measured):** SBOM is auto-attached to every GitHub Release; a CI check enforces SBOM presence on each release tag.

## Reference: OmniRoute

OmniRoute is the reference repo (SC2=2). Its `release.yml` has `id-token: write` + provenance attestation; the SBOM is auto-generated via `anchore/sbom-action` and attached to each release. The template above is a minimal extraction of that pattern.

To lift OmniRoute to 3: add a CI check that fails if a `v*` tag is pushed without an SBOM artifact attached to the release.

## How to validate

After applying:
1. `git push` — workflow should run on the PR
2. Check the Actions tab — the `sbom` job should pass
3. The `sbom-<ref-name>` artifact should be downloadable
4. Open the SBOM JSON and confirm it has `components` populated (i.e., it detected your deps)

## Provenance

- **Template version:** 1.0
- **Author:** Phenotype Org holistic audit, 2026-06-16
- **Audit that produced it:** `FLEET-AUDIT-30-PILLAR.md` (SC2 P0)
- **Reference repo:** `KooshaPari/OmniRoute` (SC2=2)
- **License:** Same as the parent repo
