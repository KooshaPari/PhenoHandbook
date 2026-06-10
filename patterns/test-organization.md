# Test Organization Pattern

**Status:** adopted · **Applies to:** every crate, package, and library in the Phenotype org (Rust, Go, TypeScript/JS, Python). Defines where unit tests, doctests, and integration tests live, and what "covered" means at the per-crate level.

## Overview

A test in the org is a contract. The contract says: every public function is exercised by a doctest (the function's behaviour, pinned at the call site), every module ships an inline `#[cfg(test)]` test module (the module's invariants), and every crate ships a `tests/` directory with at least one integration test (the crate's promise to its consumers). The org landed the test-organization shape across the first five waves of the 100-task DAG ([`DAG_100.md`](../../DAG_100.md)) — waves 3 and 4 added the bulk of the property-based, integration, and end-to-end suites, wave 5 swept the long-tail repos (McpKit, NetScript, PlatformKit, TestingKit, ValidationKit, Sidekick) through the same shape. This page is the canonical place that rule lives; it consolidates the "tests live next to the code" guidance that was previously implicit in [methodology/xdd](../methodology/xdd.md) and the "tests are the spec" guidance that was implicit in the xDD family.

If a new crate is added, vendored, or rewritten, the diff is incomplete without all three layers (doctest + `#[cfg(test)]` + `tests/`) populated. A crate with only one of the three is a crate that has not been audited; a crate with none of the three is a crate that will be re-audited before it ships. The three layers are not redundant — they catch different classes of bug, and a single layer is the gap that produces a "we tested it locally" outage.

This pattern was rolled out org-wide in five waves (`DAG_100.md`, tasks 44 and 61–77, plus 95–100). PhenoHandbook catches up after, in the order the org actually does the work.

## The Rule

| Context | Use | Default | Why |
|---------|-----|---------|-----|
| Every public function (`pub fn`, `pub async fn`, `pub struct Foo` constructor, `pub trait` method) in every Phenotype crate (Rust, Go, TS, Python) | **At least one doctest** that compiles and runs against the function's signature. Doctest asserts the happy path and at least one failure path. | 1 doctest per public fn (happy + failure) | A doctest is the function's contract pinned at the call site. A reader of the rustdoc / godoc / tsdoc / pydoc sees the behaviour in the rendered docs, not in a separate `tests/` file they have to navigate to. A function without a doctest is a function whose behaviour is whatever the implementation happens to do — there is no spec, only the code. |
| Every source module (`src/foo.rs`, `src/foo/bar.go`, `src/foo.ts`, `foo/__init__.py`) | **A `#[cfg(test)]` (Rust) / `_test.go` file (Go) / `*.test.ts` co-located file (TS) / `test_*.py` co-located file (Python)** with tests for the module's private helpers and module-level invariants. | 1 inline test module per source module | A module's invariants are private to the module. Doctests exercise the public surface; integration tests exercise the crate's promise. The middle layer — the module's internal contract — needs its own test surface, and that surface is the inline `#[cfg(test)] mod tests` block. A module without inline tests is a module whose private helpers are un-audited. |
| Every crate (Rust workspace member, Go module, npm package, Python package) | **A top-level `tests/` directory** (Rust convention; the equivalent for Go is `<pkg>_test` packages, for TS is `*.integration.test.ts` next to a top-level `tests/` or `e2e/` dir, for Python is `tests/test_*.py`). Holds the crate's promise to its consumers. | ≥ 1 integration test per crate, plus full-coverage integration tests for the crate's public surface | A crate's `tests/` directory is the boundary test. It links against the crate as an *external* consumer would, exercises the full public API, and is the layer that catches the "this works inside the crate but breaks for downstream" bug. A crate without `tests/` is a crate that has no boundary test — its public surface is exercised only by its own internal tests, which is a circular guarantee. |
| A function with non-trivial behaviour (a state machine, a parser, a cryptographic primitive, a port adapter, a serialization round-trip) | **A property-based test** (Rust: `proptest` / `quickcheck`; Go: `testing/quick` or `gopter`; TS: `fast-check`; Python: `hypothesis`) in addition to the example-based doctest. | ≥ 1 property test per non-trivial fn | Example-based tests pin specific cases. Property-based tests pin the *invariant* — "for all valid inputs, the output satisfies property P" — and find the edge cases the example-based test never enumerated. A non-trivial function with only example-based tests is a function whose edge cases are limited to the cases the author happened to think of. |
| A crate that talks to external infrastructure (Postgres, NATS, Meilisearch, Qdrant, S3, HTTP, gRPC) | **A testcontainers-based integration test** (or an in-process equivalent) that spins the dependency up in the test, not a mock. | 1 testcontainers test per external dependency | A mock is a re-implementation of the dependency under test. If the mock's behaviour diverges from the real dependency, the test passes and the production code fails. A testcontainers test runs against the real dependency in a throwaway container, and the divergence surface is the same as production. A crate that mocks its external dependencies is a crate that is testing the mock, not the integration. |
| A binary / CLI / desktop app / Tauri shell | **An end-to-end test** (Playwright, Tauri test driver, Unity Editor test asmdef, Go `os/exec` smoke) that drives the binary the way a user would. | ≥ 1 e2e test per shipping artifact | A unit test exercises the function; an integration test exercises the crate. An e2e test exercises the artifact a user installs. The three layers catch different regressions; the e2e test is the only one that catches "the binary doesn't launch" or "the CLI exits with a non-zero status on the happy path." |

**Hard rule:** a public function with no doctest is a hygiene violation. The doctest is the contract, the rustdoc/godoc is the rendered contract, and a function with neither is a function whose behaviour is whatever the implementation happens to do. Add the doctest before the PR; the lint is part of review.

**Hard rule:** a module with no inline `#[cfg(test)] mod tests` (or language-equivalent) is a hygiene violation. The inline test module is the only place private helpers get exercised. A "we test it via the integration test" justification is a circular guarantee — the integration test exercises the *public* surface, the private helpers are un-audited.

**Hard rule:** a crate with no `tests/` directory (or language-equivalent boundary test) is a hygiene violation. The `tests/` directory is the crate's promise to its downstream consumers. A "we have unit tests, that's enough" justification is the same circular guarantee — the unit tests run against the crate as the crate author sees it, the integration test runs against the crate as a downstream consumer sees it.

**Hard rule:** a non-trivial function with only example-based tests is *not exempt* from property-based tests. Property-based tests are a separate layer; they pin the invariant, not the case. The example-based doctest pins the happy path; the property test pins "for all valid inputs, the output is well-formed." A function with only the first is a function whose edge cases are bounded by the author's imagination.

**Hard rule:** a crate that mocks its external dependencies is *not exempt* from testcontainers tests. The mock is a re-implementation; the divergence surface is the bug surface. A testcontainers test runs against the real dependency, in a throwaway container, with the same wire protocol as production.

**Hard rule:** a binary that ships without an e2e test is a binary that will fail at install time, not at CI time. The e2e test is the only layer that catches "the binary doesn't launch on a clean machine," "the CLI exits non-zero on the happy path," "the Tauri shell cannot find the renderer bundle," or "the Unity asmdef is missing a reference." Unit tests cannot catch any of these; integration tests cannot catch any of these; the e2e test is the only layer that exercises the shipping artifact.

## Canonical Pattern

### A Rust crate with all three layers populated

```rust
// src/lib.rs

/// Compute the SHA-256 digest of a byte slice, lower-hex encoded.
///
/// # Examples
///
/// ```
/// use phenotype_hash::sha256_hex;
///
/// let digest = sha256_hex(b"hello");
/// assert_eq!(digest, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
/// ```
///
/// The empty input is well-defined (the SHA-256 of zero bytes):
///
/// ```
/// use phenotype_hash::sha256_hex;
///
/// let digest = sha256_hex(b"");
/// assert_eq!(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
/// ```
pub fn sha256_hex(input: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input);
    let out = hasher.finalize();
    out.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    //! Module-level invariants: helpers below `sha256_hex`, edge cases the
    //! doctest doesn't cover, and the property-based harness.

    use super::*;
    use proptest::prelude::*;

    #[test]
    fn sha256_hex_is_lowercase() {
        let digest = sha256_hex(b"Phenotype");
        assert!(digest.chars().all(|c| !c.is_ascii_uppercase()));
    }

    #[test]
    fn sha256_hex_length_is_64() {
        // SHA-256 always emits 32 bytes == 64 hex chars.
        let digest = sha256_hex(b"any input, any length");
        assert_eq!(digest.len(), 64);
    }

    proptest! {
        /// Property: for any two distinct inputs, the digests differ.
        /// This pins collision-resistance as a black-box property; the
        /// implementation is free to swap SHA-256 for SHA-3 without
        /// breaking the test, as long as the new hash is also collision-
        /// resistant on the test's input range.
        #[test]
        fn sha256_hex_is_collision_resistant_on_proptest_range(
            a in proptest::collection::vec(any::<u8>(), 0..256),
            b in proptest::collection::vec(any::<u8>(), 0..256),
        ) {
            prop_assume!(a != b);
            prop_assert_ne!(sha256_hex(&a), sha256_hex(&b));
        }
    }
}
```

```rust
// tests/sha256_hex_integration.rs
// The crate's promise to its consumers: the public API works when linked
// from outside the crate, the way every downstream user will link it.

use phenotype_hash::sha256_hex;

#[test]
fn sha256_hex_matches_known_vectors() {
    // RFC 6234 / NIST CAVP test vectors — the boundary test that pins
    // the crate's output to the canonical SHA-256 specification.
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
}
```

### A Go module with the equivalent three layers

```go
// pkg/hash/hash.go
package hash

import (
	"crypto/sha256"
	"encoding/hex"
)

// SHA256Hex computes the SHA-256 digest of the input bytes, lower-hex encoded.
//
// Example:
//
//	// "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
//	digest := hash.SHA256Hex([]byte("hello"))
func SHA256Hex(input []byte) string {
	sum := sha256.Sum256(input)
	return hex.EncodeToString(sum[:])
}
```

```go
// pkg/hash/hash_test.go
package hash

import "testing"
import "strings"

func TestSHA256HexIsLowercase(t *testing.T) {
	digest := SHA256Hex([]byte("Phenotype"))
	if strings.ToLower(digest) != digest {
		t.Errorf("digest should be lowercase, got %q", digest)
	}
}

func TestSHA256HexLengthIs64(t *testing.T) {
	digest := SHA256Hex([]byte("any input"))
	if len(digest) != 64 {
		t.Errorf("digest length should be 64, got %d", len(digest))
	}
}
```

```go
// pkg/hash/integration_test.go  (or: test/integration/hash_boundary_test.go)
package hash_test

import (
	"testing"

	"phenotype.io/x/hash/pkg/hash"
)

func TestSHA256HexBoundaryVectors(t *testing.T) {
	// Boundary test: this runs as an *external* test package
	// (pkg/hash_test, not pkg/hash), the way a downstream consumer
	// would import the module. Only the public API is visible here.
	cases := []struct {
		input    string
		expected string
	}{
		{"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
		{"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
	}
	for _, c := range cases {
		got := hash.SHA256Hex([]byte(c.input))
		if got != c.expected {
			t.Errorf("SHA256Hex(%q) = %q, want %q", c.input, got, c.expected)
		}
	}
}
```

### A TypeScript / npm package

```typescript
// src/sha256Hex.ts
import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 digest of a byte array, lower-hex encoded.
 *
 * @example
 * sha256Hex(Buffer.from("hello"))
 * // => "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
 */
export function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}
```

```typescript
// src/sha256Hex.test.ts  (vitest co-located unit test)
import { describe, it, expect } from "vitest";
import { sha256Hex } from "./sha256Hex";

describe("sha256Hex", () => {
  it("is lowercase", () => {
    const digest = sha256Hex(new TextEncoder().encode("Phenotype"));
    expect(digest).toBe(digest.toLowerCase());
  });

  it("is 64 chars long", () => {
    const digest = sha256Hex(new TextEncoder().encode("any input"));
    expect(digest).toHaveLength(64);
  });
});
```

```typescript
// tests/sha256Hex.integration.test.ts  (vitest integration test)
import { describe, it, expect } from "vitest";
import { sha256Hex } from "phenotype-hash";

describe("sha256Hex (integration)", () => {
  it("matches the canonical SHA-256 vectors", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
```

### A Python package

```python
# src/phenotype_hash/__init__.py

def sha256_hex(data: bytes) -> str:
    """Compute the SHA-256 digest of ``data``, lower-hex encoded.

    Examples
    --------

    >>> sha256_hex(b"hello")
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    """
    import hashlib
    return hashlib.sha256(data).hexdigest()
```

```python
# tests/test_sha256_hex.py
from phenotype_hash import sha256_hex


def test_sha256_hex_is_lowercase():
    digest = sha256_hex(b"Phenotype")
    assert digest == digest.lower()


def test_sha256_hex_length_is_64():
    digest = sha256_hex(b"any input")
    assert len(digest) == 64
```

Conventions (lifted from the 5-wave rollout):

- **The doctest is the smallest layer and the most-missed layer.** A function's rustdoc/godoc/tsdoc/pydoc is the rendered contract; a missing doctest means a missing contract. The doctest must compile (not just type-check), must run, and must assert at least one success path and one failure path (or document why only the success path is meaningful for the function's semantics).
- **The inline `#[cfg(test)] mod tests` block is the middle layer.** It tests private helpers, invariants, and edge cases the doctest does not enumerate. It is co-located with the source it tests (same file, Rust convention; co-located file, Go/TS/Python convention) because the proximity is the documentation — a reader of `foo.rs` sees `foo.rs`'s tests inline.
- **The `tests/` directory is the boundary layer.** Each file in `tests/` is a separate compilation unit that links against the crate as an external consumer would. A `tests/foo.rs` file is the crate saying "I promise that `foo` works the way I claim it works, and here is the proof from outside." A crate with no `tests/` is a crate that has not been audited at the boundary.
- **Property-based tests live next to example-based tests, in the same inline module.** The two layers share setup (the function under test, the input generators); separating them across files is a "where is the property test" scavenger hunt. The `proptest!` / `gopter!` / `fc.assert` block sits inside the `mod tests` block, not in a parallel `mod proptests` block.
- **Testcontainers tests live in `tests/`, not in the inline module.** The inline module is for tests that run in milliseconds; the testcontainers test spins up a Docker container and runs in seconds-to-minutes. The split between `mod tests` and `tests/` is the split between fast and slow, and the slow layer lives in the boundary test directory.
- **Doctests assert the function's behaviour, not its implementation.** A doctest that asserts "this calls `Sha256::new()`" is a test of the implementation, not a test of the contract. The contract is "the SHA-256 digest of `b"hello"` is `2cf24dba...`"; the implementation is free to swap SHA-256 for BLAKE3, for a hardware-accelerated intrinsic, or for an HSM call, as long as the output matches. Doctests that pin the implementation are brittle; doctests that pin the contract survive refactors.
- **E2E tests live in `e2e/`, not in `tests/`.** The `tests/` directory is for crate-internal boundary tests; `e2e/` is for cross-crate / cross-binary tests that exercise the shipping artifact. The two directories are separate because the runtimes are different (unit-seconds vs. minutes) and the failure modes are different (the `tests/` test fails on a function regression; the `e2e/` test fails on a binary regression).
- **Coverage is a per-crate number, not a per-line number.** A crate with 100% line coverage and no `tests/` directory is a crate with a perfect circular guarantee; a crate with 80% line coverage and a comprehensive `tests/` directory is a crate with a measured external guarantee. The org's coverage gate (see `wave4-task65: phenoMCP-coverage-gate`) measures the *crate* number, not the *line* number.

## Reference: test additions in waves 1–5

The pattern was first executed end-to-end against the 100-task DAG at the monorepo root ([`DAG_100.md`](../../DAG_100.md), with v1/v2/merged variants under `FLEET_100TASK_DAG*.md`). The five waves ran a mix of stabilization, standardization, test additions, and cross-repo consolidation; the test-organization shape is the consolidation target every wave was working toward. The table below lists the test-related tasks by wave. The "Test layer" column is the canonical three-layer split (doctest / `#[cfg(test)]` / `tests/`) plus the two extension layers (property / testcontainers / e2e) the org uses for non-trivial crates.

| Wave | Task | Repo | Test layer added | Notes |
|------|------|------|------------------|-------|
| **Wave 1 — STABILIZE** (tasks 1–20) | (none) | — | — | Wave 1 was repo hygiene (clean dirty state, drop stashes, close boilerplate issues, push unpushed commits). No test additions; the wave's contract was a clean `main` for wave 2 to build on. Test additions begin in wave 3. |
| **Wave 2 — STANDARDIZE** (tasks 21–40) | `wave2-task26: phenotype-postfx-standardize` (action: "Add Taskfile with `dotnet build/test` tasks, replace Python grep CI with `dotnet format` + `dotnet build`") | phenotype-postfx | `tests/` (introduces a test task in the local task runner, not a test addition per se) | The wave 2 test touchpoint is structural: a `dotnet test` task in the Taskfile is the prerequisite for wave 3 to add tests, because the CI runner needs a `test` target to call. Wave 2 did not add tests; it added the *entry point* for the test runner. |
| **Wave 3 — MODERNIZE** (tasks 41–60) | `wave3-task44: phenoMCP-integration-tests` (action: "Add integration tests for Meilisearch, Qdrant, and SurrealDB backends using testcontainers or mock servers"; output: "Integration test suite for all 3 backends") | phenoMCP | `tests/` + testcontainers (one per external dependency: Meilisearch, Qdrant, SurrealDB) | The first test-organization rollout wave. The phenoMCP repo had doctests and `#[cfg(test)]` modules but no `tests/` directory and no testcontainers tests; this task added both. Three testcontainers tests, one per backend, each spinning the real dependency in a throwaway Docker container. The task is the org's reference for "tests/ directory + testcontainers + one test per external dependency." |
| **Wave 4 — SOTA** (tasks 61–80; "Advanced testing, coverage, performance, advanced tooling") | `wave4-task61: kmobile-property-tests` (proptest / quickcheck for `Config` deserialization) | kmobile | `#[cfg(test)]` (property) | Property-based tests for the `Config` deserializer. Pins the "for any valid YAML, the deserializer produces a well-formed `Config`" invariant; the example-based tests in the doctest pin the canonical cases. |
| | `wave4-task64: phenoMCP-property-tests` (proptest for `QueryPort`, `IndexPort`, `VectorPort`) | phenoMCP | `#[cfg(test)]` (property) | Property tests for the port contracts. The three ports are the org's hexagonal boundary; the property tests pin the contracts that the ports make to their adapters. |
| | `wave4-task65: phenoMCP-coverage-gate` (80% threshold, `cargo-llvm-cov`, Codecov upload) | phenoMCP | coverage gate (CI) | The org's reference coverage-gate configuration. 80% is the threshold; the gate is the *crate* number, not the *line* number (per the conventions above). The gate fails the CI run if any crate in the workspace drops below 80%. |
| | `wave4-task66: phenoAgent-property-tests` (msgpack round-trip) | phenoAgent | `#[cfg(test)]` (property) | Property test for the RPC serialization layer. Pins the "for any `RpcMessage`, `decode(encode(m)) == m`" invariant across the full input space. |
| | `wave4-task67: phenoAgent-integration-tests` (NATS messaging, process lifecycle) | phenoAgent | `tests/` + testcontainers (NATS) | The first cross-process integration test in the org. Spins a NATS container, exercises the daemon's publish / subscribe paths, and exercises the process-lifecycle hooks (start, signal, graceful-shutdown). The task is the org's reference for "tests/ + testcontainers + cross-process." |
| | `wave4-task68: BytePort-property-tests` (PASETO auth token) | BytePort | `#[cfg(test)]` (property) | Property test for the PASETO auth layer. Pins the "for any valid token, the validator accepts; for any mutated token, the validator rejects" invariant. |
| | `wave4-task69: BytePort-backend-tests` (backend APIs: nvms + byteport) | BytePort | `tests/` + testcontainers (HTTP, via `httptest`) | Integration tests for the backend HTTP surface. Uses `httptest`-style mock servers (Go) for the upstream calls; the boundary test runs against the real `nvms` and `byteport` binaries. |
| | `wave4-task70: BytePort-tauri-e2e` (Tauri desktop app, Playwright / Tauri test driver) | BytePort | `e2e/` (Playwright / Tauri test driver) | The first e2e test in the org. Drives the Tauri shell the way a user would: launch the app, click a button, assert the renderer's response. The task is the org's reference for "e2e/ + Tauri test driver." |
| | `wave4-task71: FocalPoint-property-tests` (focus rules engine: rule matching, conflict resolution) | FocalPoint | `#[cfg(test)]` (property) | Property tests for the focus rules engine. Pins the "for any set of rules, the resolver picks a non-conflicting subset" invariant. |
| | `wave4-task72: FocalPoint-connector-tests` (GitHub, GCal, Notion, Linear; mock servers) | FocalPoint | `tests/` + mock servers (one per external API) | Integration tests for the connector-* crates. Each connector gets its own boundary test against a mock server that simulates the upstream API. (The task is the org's reference for "tests/ + mock servers" for cases where testcontainers is not applicable — these are third-party SaaS APIs, not local services.) |
| | `wave4-task73: FocalPoint-benchmarks` (criterion, rule evaluation, window matching) | FocalPoint | `benches/` (criterion) | Benchmark suite for the focus engine. Criterion is the org's reference for Rust benchmarks; the suite produces tracked baselines in CI. (Benchmarks are not "tests" in the strict sense; they live in `benches/`, not `tests/`, and run on a different CI cadence.) |
| | `wave4-task75: phenotype-postfx-runtime-tests` (Unity Editor test asmdef; load each shader, verify compilation) | phenotype-postfx | `e2e/` (Unity test asmdef) | The Unity-specific e2e layer. A `.asmdef` test assembly that loads each shader in the editor and asserts it compiles without errors. The task is the org's reference for "e2e/ + Unity test asmdef" for game-engine crates. |
| | `wave4-task76: phenotype-postfx-property-tests` (PostFxPass ordering: "LUT must come after ACES") | phenotype-postfx | `#[cfg(test)]` (property) | Property test for the post-fx pass ordering. Pins the "for any valid pass set, the ordering is a topological sort that respects the dependency graph" invariant; the specific case (LUT-after-ACES) is one of many dependency edges. |
| | `wave4-task77: phenotype-voxel-replay-tests` (deterministic replay for `DirtyChunkEvent` ordering) | phenotype-voxel | `tests/` (deterministic replay) | Integration test for the voxel's event log. Replays a recorded sequence of `DirtyChunkEvent`s and asserts the resulting chunk state matches the recorded baseline. The task is the org's reference for "tests/ + deterministic replay" for event-sourced systems. |
| **Wave 5 — CROSS-REPO + CONSOLIDATION** (tasks 81–100) | `wave5-task95: McpKit-audit-standardize` (action: "Full audit + standardize: add CI, add tooling, fix build, add tests"; output: "Modernized repo") | McpKit | `tests/` + `#[cfg(test)]` (audit-driven addition) | Wave 5 audit task. The McpKit repo had no `tests/` directory; this task added one, populated the inline `#[cfg(test)]` modules that were missing, and added doctests to the public functions. The task is the org's reference for "wave 5 audit-standardize" — the recipe for bringing a long-tail repo to the test-organization shape. |
| | `wave5-task96: NetScript-audit-standardize` (same recipe) | NetScript | `tests/` + `#[cfg(test)]` (audit-driven addition) | Same as `wave5-task95`. NetScript's public surface was un-audited; the task added the three-layer shape and verified the boundary test runs against the real Go module consumers. |
| | `wave5-task97: PlatformKit-audit-standardize` (same recipe) | PlatformKit | `tests/` + `#[cfg(test)]` (audit-driven addition) | Same as `wave5-task95`. PlatformKit is a Go service; the audit added Go-style `_test.go` files and the `<pkg>_test` boundary test packages. |
| | `wave5-task98: TestingKit-audit-standardize` (same recipe) | TestingKit | `tests/` + `#[cfg(test)]` (audit-driven addition) | The irony note: `TestingKit` is a repo whose purpose is to provide testing utilities, and yet it did not have its own `tests/` directory. Wave 5 closed the gap. The task is the org's reference for "the testing-utility repo is held to the same standard as the crates that consume it." |
| | `wave5-task99: ValidationKit-audit-standardize` (same recipe) | ValidationKit | `tests/` + `#[cfg(test)]` (audit-driven addition) | Same as `wave5-task95`. ValidationKit is a Go validation library; the audit added the boundary test package and the doctest-equivalent Go example tests. |
| | `wave5-task100: Sidekick-audit-standardize` (same recipe) | Sidekick | `tests/` + `#[cfg(test)]` (audit-driven addition) | Same as `wave5-task95`. Sidekick is a multi-crate Rust workspace; the audit added `tests/` to each member crate and verified the coverage gate (lifted from `wave4-task65: phenoMCP-coverage-gate`) is met. |

Operational notes from the five waves:

- **Waves 1 and 2 added no tests; they added the prerequisites.** Wave 1 cleaned dirty state so wave 2's CI runs were green; wave 2 added the test entry points (Taskfile / justfile `test` tasks) so wave 3's test additions had a CI hook to run against. Skipping the prerequisites and going straight to test additions produces a "test added, CI doesn't run it" outage.
- **Wave 3 added the first test-organization shape end-to-end.** `wave3-task44: phenoMCP-integration-tests` is the task the org points to when explaining "what does the test-organization pattern look like in production." The repo before wave 3 had doctests and `#[cfg(test)]` modules; the repo after wave 3 had doctests, `#[cfg(test)]` modules, a `tests/` directory, and testcontainers tests for all three external backends. The diff is the org's reference.
- **Wave 4 was the bulk-addition wave (13 of 20 tasks were test-related).** Property tests, integration tests, e2e tests, coverage gate, and benchmarks all landed in a single wave. The wave's contract was "every non-trivial function in the SOTA slice of the org gets a property test"; the wave 4 table above is the inventory.
- **Wave 5 was the audit-sweep wave (6 of 20 tasks were audit-standardize).** The wave's contract was "every repo in the long tail has the three-layer shape." The audit-standardize recipe is the same across all six: add `tests/`, populate missing `#[cfg(test)]` modules, add doctests, verify the boundary test runs against real consumers. The recipe is the org's reference for "what does a wave 5 audit look like."
- **The coverage gate (`wave4-task65: phenoMCP-coverage-gate`) is the enforcement layer.** 80% is the threshold; the gate runs in CI on every PR; the gate fails the build if a crate drops below 80%. The gate is the *crate* number, not the *line* number — a crate at 100% line coverage with no `tests/` directory would still fail the gate, because the gate measures the *external* test surface, not the *internal* line coverage.
- **The 80% threshold is the floor, not the ceiling.** A crate at 80.1% is technically passing; a crate at 80.1% is not *covered*. The org's target is 90%+ for the domain layer and 85%+ for the application layer (lifted from `historical/BLUEPRINT.md`'s coverage-target table). The 80% gate is the *floor*; the 90% target is the *goal*.
- **This page itself is a wave artifact.** `chore/phenohandbook-test-organization-pattern-20260608` is the branch that produced this page; it was cut by the orchestrator for the wave that documented the test-organization pattern across the PhenoHandbook repo, and is the canonical reference for the three-layer shape in the org's conventions spine.

## Anti-Patterns

- ❌ A public function with no doctest — the function's behaviour is whatever the implementation happens to do; the rendered rustdoc / godoc / tsdoc / pydoc shows the signature and a sentence, not a worked example. Add the doctest before the PR; the lint is part of review. A "the function is self-evident" justification is a "we tested it locally" justification; the rustdoc is what the next reader sees, and the next reader does not have the local context.
- ❌ A module with no inline `#[cfg(test)] mod tests` block (or `_test.go` / `*.test.ts` / `test_*.py` equivalent) — the module's private helpers are un-audited. A "we test it via the integration test" justification is a circular guarantee: the integration test exercises the *public* surface, the private helpers are inside the crate and the integration test does not see them. The inline module is the only layer that does see them.
- ❌ A crate with no `tests/` directory (or `<pkg>_test` package / `*.integration.test.ts` / `tests/test_*.py` equivalent) — the crate's promise to its downstream consumers is un-audited. A "we have unit tests, that's enough" justification is the same circular guarantee: the unit tests run against the crate as the crate author sees it, the `tests/` directory runs against the crate as a downstream consumer sees it. The two surfaces are different, and the boundary test is the only one that exercises the downstream surface.
- ❌ A non-trivial function with only example-based tests — the function's edge cases are bounded by the cases the author happened to think of. A property test pins the *invariant* ("for all valid inputs, the output satisfies P"); an example-based test pins the *case* ("for input X, the output is Y"). The two layers are not redundant. A function that needs a property test is a function that has an invariant; an example-based test does not pin the invariant, it pins the case.
- ❌ A crate that mocks its external dependencies (Postgres, NATS, Meilisearch, Qdrant, S3, HTTP) — the test passes against the mock and fails against production, every time. A testcontainers test runs against the real dependency in a throwaway container; the divergence surface is the same as production. A mock is a re-implementation; if the mock's behaviour diverges from the real dependency (and it will, because mocks are written by humans who do not have the dependency's source code in front of them), the test passes and the production code fails.
- ❌ A binary / CLI / desktop app / Tauri shell with no e2e test — the binary will fail at install time, not at CI time. The unit tests cannot catch "the binary doesn't launch on a clean machine"; the integration tests cannot catch "the CLI exits non-zero on the happy path"; the `tests/` directory cannot catch "the Tauri shell cannot find the renderer bundle." The e2e test is the only layer that exercises the shipping artifact, and a binary without an e2e test is a binary that has never been launched end-to-end.
- ❌ A doctest that pins the implementation, not the contract — `assert_eq!(sha256_hex(b"hello"), "2cf24dba...")` is a contract test; `assert!(sha256_hex(b"hello").starts_with("2c"))` is an implementation test (the first two hex digits of the SHA-256 happen to be `2c` for this input, but the *contract* is the full 64 hex chars). A doctest that pins the implementation is brittle; a doctest that pins the contract survives refactors. The rule is "doctests assert the function's behaviour, not its implementation" — the implementation is free to swap SHA-256 for BLAKE3, for a hardware-accelerated intrinsic, or for an HSM call, as long as the output matches the contract.
- ❌ A test that exists only "to make CI green" — a test that is added to satisfy a coverage gate but that does not actually exercise the function's behaviour. A coverage gate at 80% is a *floor*; a test that runs the function with a no-op assertion (`fn test_foo() { foo(); }`) brings the line coverage up without testing anything. The gate is the wrapper; the test quality is the contract. A test that does not assert the function's behaviour is a test that is not a test.
- ❌ A `tests/` directory that exercises the *internal* API, not the *external* one — the whole point of the `tests/` directory is to link against the crate as an *external* consumer would. A `tests/foo.rs` that uses `crate::private_helper` to set up state is a test that is exercising the internal API, and the test would fail to compile against a downstream consumer. The boundary test should use only the crate's `pub` surface; if the test needs a private helper, the helper should be exposed (with a `#[doc(hidden)]` if necessary) or the test should be in `mod tests` instead.
- ❌ Property-based tests with no shrink / no replay — a property test that finds a counter-example but cannot shrink it to the minimal failing case is a property test that produces a 10MB input the human cannot read. Proptest / quickcheck / fast-check / hypothesis all support shrink; use it. A property test with a `prop_assume!` that hides the counter-example is a property test that the next reviewer will re-run, see the same failure, and disable. The shrink is the contract; the replay is the audit trail.
- ❌ Testcontainers tests that share state across tests (a single container, a single DB, a single NATS connection reused by 20 tests) — the tests become order-dependent, the failure in test 17 contaminates test 18, and the parallel test runner's "tests run in random order" property produces a flake that cannot be reproduced. Each test spins its own container; each test cleans up after itself. The container is throwaway, the test is hermetic, the CI run is deterministic.
- ❌ A `coverage: 100%` badge on a crate with no `tests/` directory — a circular guarantee. The 100% number is the *internal* line coverage, and the internal line coverage is high because the unit tests exercise every line; the `tests/` directory is the *external* boundary test, and the boundary test is what the downstream consumer runs. A 100% line-coverage number without a `tests/` directory is a green badge on a circular guarantee. The coverage gate (`wave4-task65: phenoMCP-coverage-gate`) measures the *crate* number, which requires the `tests/` directory to exist before the gate can measure anything.

## Migration Checklist (per crate)

1. **Inventory the public surface.** List every `pub fn`, `pub async fn`, `pub struct` constructor, and `pub trait` method in the crate. Each one is a candidate for a doctest. The list is the diff plan; the list is the PR description's "what changed" section.
2. **Add a doctest to every public function.** A doctest that compiles, runs, and asserts at least the happy path. A doctest that documents a failure path is a bonus; the failure-path doctest is what catches the "this function used to return `Result<T, E>`, now it returns `Option<T>`" regression. A function with no doctest is a hygiene violation; fix it before the PR is mergeable.
3. **Add a `#[cfg(test)] mod tests` block to every source module.** The block tests the module's private helpers and module-level invariants. The block is co-located with the source it tests (same file, Rust; co-located file, Go/TS/Python). A module with no inline test module is a hygiene violation; the inline test is the only place private helpers get exercised.
4. **Add a `tests/` directory at the crate root.** Each file in `tests/` is a separate compilation unit that links against the crate as an external consumer. Start with one file per public module; grow the directory as the public surface grows. A crate with no `tests/` is a hygiene violation; the boundary test is the only layer that exercises the crate's external promise.
5. **Add property-based tests for non-trivial functions.** A non-trivial function is a function with an invariant that holds across an input space larger than the cases the author can enumerate. Property tests pin the invariant; example tests pin the cases. A non-trivial function with only example-based tests is a hygiene violation; the property test is the layer that finds the edge cases the example tests did not.
6. **Add testcontainers tests for external dependencies.** One test per external dependency (Postgres, NATS, Meilisearch, Qdrant, S3, HTTP, gRPC). Each test spins the dependency up in a throwaway container; each test cleans up after itself. A crate that mocks its external dependencies is a hygiene violation; the testcontainers test is the layer that runs against the real dependency, with the same wire protocol as production.
7. **Add an e2e test for every shipping binary.** A `e2e/` directory (separate from `tests/`); a Playwright / Tauri test driver / Unity test asmdef / Go `os/exec` smoke. A binary without an e2e test is a hygiene violation; the e2e test is the only layer that catches "the binary doesn't launch on a clean machine."
8. **Wire the test runner into the local task runner.** A `just test` (or `task test`, or `dotnet test`) target that runs the doctests, the inline tests, the integration tests, the property tests, the testcontainers tests, and the e2e tests in order. The local task runner is the wrapper; the CI runner is the enforcement. A crate with no `test` target in the local task runner is a crate whose tests are run by hand, which is the same as "tests are not run."
9. **Wire the coverage gate into CI.** A `cargo llvm-cov` (or `go test -cover` / `vitest --coverage` / `pytest --cov`) step in `.github/workflows/ci.yml`, with a threshold of 80% on the *crate* number. The gate fails the build if a crate drops below 80%. The gate is the floor; the goal is 90%+ for domain, 85%+ for application.
10. **Verify with the local task runner that the test suite is green.** `just test` (or the language-equivalent) runs every layer end-to-end. The PR is not mergeable until the local task runner is green; the local task runner is the wrapper around the CI run; the CI run is the enforcement.

## Related Patterns

- [methodology/xdd](../methodology/xdd.md) — the xDD-first convention (TDD/BDD/SDD/CDD/DDD/PDD). This page is the *operationalization* of the TDD slice: the three-layer test shape is the org's interpretation of "tests are the spec, the tests are written first, the tests live next to the code." The doctest is the SDD slice (spec-driven); the `#[cfg(test)]` module is the TDD slice (test-driven); the `tests/` directory is the CDD slice (contract-driven).
- [methodology/wrap-over-handroll](../methodology/wrap-over-handroll.md) — wrap existing ecosystem behind ports. The test-organization pattern interacts with wrap-over-handroll at the port boundary: a port's contract is a property test's invariant, and the property test (`wave4-task64: phenoMCP-property-tests`) pins the contract that the adapters must satisfy. A port without a property test is a port whose contract is un-audited.
- [architecture/hexagonal](hexagonal.md) — ports & adapters. The `tests/` directory is the boundary test for the hexagon's outer edge; the `#[cfg(test)]` module is the test for the hexagon's inner edge (the domain); the doctest is the test for the hexagon's ports. The three layers map cleanly to the three concentric rings of the hexagonal architecture.
- [ci/never-billable-ci](../ci/never-billable-ci.md) — the broader CI-hygiene rule: avoid billable minutes, pin runners to `ubuntu-24.04`, SHA-pin third-party actions, use least-privilege `permissions:`, and add `concurrency.cancel-in-progress`. The test-organization pattern interacts with the CI billable-minutes surface: a test suite that runs in 5 minutes is fine; a test suite that runs in 50 minutes (because it has 2000 example-based tests instead of 200 property tests) is a CI billable-minutes surface. Property-based tests are *cheaper* than example-based tests in CI wall-clock, because one property test covers 1000 cases in a single run.
- [ci/build-verification](../build-verification.md) — the `timeout-minutes: 10` rule. The test-organization pattern interacts with the job-level timeout: a `cargo test --workspace` job that runs in 8 minutes needs the 10-minute cap; a `cargo test --workspace` job that runs in 12 minutes needs an explicit 15-minute cap. The cap is per-job, not per-test, and the test organization is the wrapper that keeps the cap reasonable.
- [parallel-execution](../parallel-execution.md) — the worktree-per-subagent model. The five waves of test additions were executed as part of a multi-subagent fan-out; the worktree model is the *shape* that test-organization rollout takes when the fan-out is org-scale. The `chore/phenohandbook-test-organization-pattern-20260608` branch follows the same `chore/<repo>-<purpose>-<date>` convention.
- [traceability/requirements](../traceability/requirements.md) — the FR/NFR → code → test → PR traceability chain. The test-organization pattern is the *test* slice of the chain: the doctest pins the FR, the `#[cfg(test)]` module pins the implementation's invariants, the `tests/` directory pins the contract. A test that does not trace back to a requirement is a test that is not a test (lifted from the circular-guarantee anti-pattern above).
- [spine-roles](../spine-roles.md) — the 4-role split (index / ADRs / conventions / enforcement). This page is the *conventions* slice of the test-organization shape; the registry indexes the waves, PhenoSpecs would hold an ADR if the test-organization shape ever needs to change, and governance enforces the coverage gate (currently via CI, not via a central linter).

## References

- [`DAG_100.md`](../../DAG_100.md) — the 100-node fleet DAG at the monorepo root. The test-organization pattern is documented across the 5 waves; the table above is the inventory. The DAG is the org's source of truth for "what work actually happened in the test-organization rollout."
- [`FLEET_100TASK_DAG.md`](../../FLEET_100TASK_DAG.md) — v1 of the 100-task DAG (the original spec).
- [`FLEET_100TASK_DAG_v2.md`](../../FLEET_100TASK_DAG_v2.md) — v2 of the 100-task DAG (post-first-wave revisions).
- [`FLEET_100TASK_DAG_V2_MERGED.md`](../../FLEET_100TASK_DAG_V2_MERGED.md) — v2 merged into the live DAG state; the audit-trail file for the org's "how do we know a wave actually landed" answer.
- [`historical/BLUEPRINT.md`](../../historical/BLUEPRINT.md) — the original Phenotype blueprint. The coverage targets (90%+ for domain, 85%+ for application) and the "tests in `tests/integration/`" directory layout are the blueprint-level ancestors of the test-organization pattern. The blueprint is descriptive of intent; the pattern is descriptive of current practice.
- [`historical/SOTA.md`](../../historical/SOTA.md) — the original SOTA reference. The "80% unit, 15% integration, 5% e2e" coverage split and the "unit + integration + e2e" three-layer test shape are the SOTA-level ancestors of the test-organization pattern. The SOTA is descriptive of intent; the pattern is descriptive of current practice.
- Internal: `chore/phenohandbook-test-organization-pattern-20260608` — the branch that produced this page. Cut by the orchestrator for the wave that documented the test-organization pattern across the PhenoHandbook repo, and the canonical reference for the three-layer test shape in the org's conventions spine.
- Internal: `chore/phenohandbook-parallel-execution-pattern-20260608` — the sibling pattern that documents the worktree-per-subagent model. The test-organization rollout was executed as part of a multi-subagent fan-out; the parallel-execution pattern is the *shape* the test-organization rollout took.
- Internal: `chore/phenohandbook-build-verification-pattern-20260608` — the sibling pattern that documents the `timeout-minutes: 10` rule. The CI jobs that run the test-organization shape's `cargo test --workspace` / `go test ./...` / `vitest run` / `pytest` commands are subject to the 10-minute cap; the cap is the wrapper, the test-organization shape is the workload.
- External: [Rust Book — Testing](https://doc.rust-lang.org/book/ch11-00-testing.html) — the canonical Rust reference for `#[cfg(test)]` modules, `tests/` directories, and doctests. The pattern in this page is the org's interpretation of the Rust Book's recommendations, lifted to a cross-language convention.
- External: [proptest](https://github.com/proptest-rs/proptest), [quickcheck](https://github.com/BurntSushi/quickcheck), [fast-check](https://github.com/dubzzz/fast-check), [hypothesis](https://hypothesis.readthedocs.io/) — the property-based testing libraries for Rust, Rust, TypeScript, and Python respectively. The org's reference for property-based testing.
- External: [testcontainers](https://testcontainers.com/) — the testcontainers libraries for Rust, Go, TypeScript, and Python. The org's reference for "run the integration test against the real dependency in a throwaway container."
