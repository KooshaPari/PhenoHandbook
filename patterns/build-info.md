# Build Info / Versioning Pattern

## Overview

Every Rust binary in the Pheno* ecosystem that needs to log its build metadata, embed it in a `/healthz` response, surface it through a `tracing` event, or attach it to an error envelope goes through one crate: `phenotype-build-info`. This page is the canonical place that rule lives; it consolidates the "read compile-time env" guidance that was previously implicit in the inline `env!("CARGO_PKG_VERSION")`, `option_env!("PHENOTYPE_GIT_SHA")`, and `cfg!(debug_assertions)` blocks scattered across `phenoShared` binaries, the various `*-adapter` crate `version!()`-style macros, and the hand-rolled `BuildInfo { version, git_sha, profile, target }` structs in `HeliosLab`, `PhenoRuntime`, `KWatch`, and `phenoMCP`.

If a binary needs to print or expose its version, it imports `phenotype_build_info::pkg_version` (or `phenotype_build_info::BuildInfo` when it needs more than just the version). If a `Cargo.toml` adds a `version` macro or a hand-rolled `env!`-parsing block, either fix the crate or update this page — don't fork the rule. The `phenotype-build-info` crate exists for exactly this reason: one place to own the `const fn` accessors, the `BuildInfo` struct, the `Display` shape, the `PHENOTYPE_GIT_SHA → "unknown"` fallback, and the `build.rs` that lifts Cargo's `TARGET` env var into something a library can read.

## The Rule

| Context | Use | Crate / Symbol | Why |
|---------|-----|----------------|-----|
| A Rust binary or library that needs its own package version as a `&'static str` | `env!("CARGO_PKG_VERSION")` at the call site, **or** a `static VERSION: &str = phenotype_build_info::pkg_version();` when you want to pin to the `phenotype-build-info` crate's version (almost never) | `phenotype-build-info` (optional) | `env!("CARGO_PKG_VERSION")` is the only way to read *the consuming crate's* own version. `phenotype_build_info::pkg_version()` returns the version of the `phenotype-build-info` crate itself (`0.1.0` today), not your crate's — see the warning in [What `pkg_version` returns](#what-pkg_version-returns). |
| A binary needs to log / return its full build metadata (version + git SHA + profile + target) | `phenotype_build_info::build_info() -> BuildInfo` | `phenotype-build-info` | One struct, one `Display` impl, no allocations, no `format!` glue at the call site. |
| A caller needs just the release flag (`"debug"` vs `"release"`) | `phenotype_build_info::is_release_build()` (bool) or `phenotype_build_info::version::build_profile()` (`&'static str`) | `phenotype-build-info` | Both are `const fn`, both derive from `cfg!(debug_assertions)` in one place, so every binary's "is this a release build" answer agrees. |
| A caller needs just the target triple (e.g. `"aarch64-apple-darwin"`) | `phenotype_build_info::version::target_triple() -> &'static str` | `phenotype-build-info` | `TARGET` is only visible to `build.rs`; the crate's `build.rs` lifts it into `PHENOTYPE_TARGET` so a library can read it. |
| A caller needs just the git SHA | `phenotype_build_info::version::git_sha() -> &'static str` | `phenotype-build-info` | Returns the value of `PHENOTYPE_GIT_SHA` if set, or the literal `"unknown"` if not — never panics, never `None`. |
| Test or build script that needs the same metadata | Same accessors as above | `phenotype-build-info` | `cargo test` runs in debug, so `is_release_build()` is `false` and `build_profile()` is `"debug"` — the accessors are test-safe by construction. |

**Hard rule:** `env!("CARGO_PKG_VERSION")` followed by a hand-rolled `BuildInfo { version, git_sha: option_env!(...).unwrap_or("unknown"), profile: if cfg!(debug_assertions) { "debug" } else { "release" }, target: env!("TARGET") }` is forbidden in Phenotype binaries. The defaults are wrong for us: `env!("TARGET")` does not compile in a library (Cargo only sets it for `build.rs`), the `option_env!` + `unwrap_or` shape is re-implemented at every call site and silently breaks the day someone wants a different `"unknown"` string, and the inline struct skips the canonical `Display` shape so two binaries format their build info differently.

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-build-info = { path = "../phenotype-build-info" }

# Do NOT add a `version` macro, a `build_info!` proc-macro, or a
# hand-rolled `pub const VERSION: &str = env!(...)` constant in a
# consumer crate just to surface a version. Depend on
# `phenotype-build-info` and reach for its accessors.
#
# `phenotype-build-info` has no transitive dependencies, so the cost
# of pulling it in is a single `path =` line and a build script that
# runs in <1 ms.
```

### Use the accessors in a binary

```rust
// crates/<name>/src/main.rs (binary)
use std::process::ExitCode;
use phenotype_build_info::{build_info, is_release_build, pkg_version};

fn main() -> ExitCode {
    // One-line startup banner, identical shape across every Pheno*
    // binary. `BuildInfo`'s `Display` impl renders
    // "<version> (<profile> <target>, git <sha>)".
    println!("{} starting up", build_info());

    // Gate a dev-only backdoor on the canonical flag, not on a
    // hand-rolled `cfg!(debug_assertions)` check.
    if !is_release_build() {
        eprintln!("warning: debug build, dev backdoors enabled");
    }

    run_service();
    ExitCode::SUCCESS
}

/// A `static` initializer is fine — all three accessors are `const fn`.
#[allow(dead_code)]
static VERSION: &str = pkg_version();
```

### Embed `BuildInfo` in a `/healthz` response

```rust
// crates/<name>/src/health.rs
use serde::Serialize;
use phenotype_build_info::build_info;

#[derive(Serialize)]
pub struct HealthReport {
    pub status: &'static str,
    pub build: phenotype_build_info::BuildInfo,
}

pub fn healthz() -> HealthReport {
    // `BuildInfo` is `#[derive(Copy)]` and holds four `&'static str`s,
    // so this is a copy, not a clone or an allocation.
    HealthReport { status: "ok", build: build_info() }
}
```

### Attach build metadata to a `tracing` event

```rust
// crates/<name>/src/error.rs
use tracing::error;
use phenotype_build_info::build_info;

pub fn report_failure(err: &(dyn std::error::Error + 'static)) {
    // Spread the `BuildInfo` into a structured log line. The fields
    // are `&'static str`, so there's no allocation in the hot path.
    let info = build_info();
    error!(
        error = %err,
        version = info.version,
        git_sha = info.git_sha,
        profile = info.build_profile,
        target = info.target_triple,
        "operation failed",
    );
}
```

Conventions (lifted from `phenoShared/crates/phenotype-build-info/src/version.rs:39-185`):

- The accessor trio (`pkg_version`, `is_release_build`, `build_profile`) is `const fn`; `target_triple` and `git_sha` are also `const fn`. Prefer them in `static` initializers (`static VERSION: &str = pkg_version();`) so the linker can fold the call away.
- `BuildInfo` derives `Debug, Clone, Copy, PartialEq, Eq, Hash` and holds four `&'static str` fields — embed it directly, don't box it, don't `Arc` it.
- `BuildInfo`'s `Display` impl is the only canonical format: `"<version> (<profile> <target>, git <sha>)"`. If a caller needs a different shape (e.g. a JSON envelope, a Prometheus label set), build it on top of the struct's fields, never re-derive the string with `format!`.
- `git_sha()` returns the literal `"unknown"` when `PHENOTYPE_GIT_SHA` is unset. Treat the string as opaque; do not branch on it (a future change to surface `"unknown-sha-N"` for reproducibility would otherwise break you).
- `is_release_build()` is `false` under `cargo test`. Tests that gate behaviour on the build profile must use a feature flag, not the accessor, or they will silently no-op in CI.

## What `pkg_version` Returns

This is the most-confused part of the API, and the reason the rule says "use `env!("CARGO_PKG_VERSION")` at the call site for your own version":

- `phenotype_build_info::pkg_version()` returns the value of `env!("CARGO_PKG_VERSION")` *evaluated inside the `phenotype-build-info` crate*. That is the version of the `phenotype-build-info` crate itself — `0.1.0` today — **not** the version of the consuming binary.
- A consumer that wants its own version in a log line has two choices, in order of preference:
  1. Use `env!("CARGO_PKG_VERSION")` directly at the call site. The macro is inlined at compile time, has zero runtime cost, and reads the *consuming* crate's version by construction. This is the right answer for the vast majority of binaries.
  2. Use `phenotype_build_info::build_info()` and read `info.version`. Same caveat: today this returns the `phenotype-build-info` crate's version, not yours. This shape is the right answer only when you also need `git_sha` / `build_profile` / `target_triple` and want one struct, not four accessor calls.
- A future change may introduce a `phenotype_build_info::cargo_pkg_version!()` macro or a build-time codegen step that propagates the *consuming* crate's version into `phenotype-build-info` at compile time. Until then, the two patterns above are the only sanctioned shapes — do not re-export `pkg_version()` from a consuming crate under a different name and pretend it's your crate's version.

## What `phenotype-build-info` Configures

The crate is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Build script entry | `phenoShared/crates/phenotype-build-info/build.rs:16-29` reads `env::var("TARGET")` and emits `cargo:rustc-env=PHENOTYPE_TARGET=<target>` | `TARGET` is only visible to `build.rs`; lifting it to `PHENOTYPE_TARGET` is the only way a library can read it. The script also emits `cargo:rerun-if-env-changed=TARGET` and `cargo:rerun-if-env-changed=PHENOTYPE_GIT_SHA` so the build re-runs when either changes, and writes a marker file under `OUT_DIR` to satisfy `cargo:rerun-if-changed=build.rs` on hosts where the script's mtime is preserved across copies. |
| `git_sha` fallback | `match option_env!("PHENOTYPE_GIT_SHA") { Some(sha) => sha, None => "unknown" }` (`phenoShared/crates/phenotype-build-info/src/version.rs:109-114`) | The fallback is the literal string `"unknown"`, not a panic, not `None`, not an empty string. A developer-machine `cargo build` that did not opt into a workspace `build.rs` that populates `PHENOTYPE_GIT_SHA` still compiles and runs. |
| `is_release_build` mapping | `!cfg!(debug_assertions)` (`phenoShared/crates/phenotype-build-info/src/version.rs:62-64`) | `debug_assertions` is on for `dev` and `test` profiles and off for `release` and `bench`. The mapping is exhaustive over Cargo's out-of-the-box profiles. |
| `build_profile` mapping | `if cfg!(debug_assertions) { "debug" } else { "release" }` (`phenoShared/crates/phenotype-build-info/src/version.rs:72-78`) | The string is the Cargo profile name, lowercase. |
| `BuildInfo::Display` shape | `"<version> (<profile> <target>, git <sha>)"` (`phenoShared/crates/phenotype-build-info/src/version.rs:148-159`) | One canonical format. Operators learn one shape; log scrapers regex against one shape. |
| `BuildInfo` field types | Four `&'static str` fields, `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]` (`phenoShared/crates/phenotype-build-info/src/version.rs:136-146`) | No allocations, no `String`, no `Option`. Embed it in a `tracing` event, a `serde::Serialize` struct, or a `static` without ceremony. |
| `PHENOTYPE_GIT_SHA` population | **Out of scope for this crate** — a workspace-level `build.rs` or CI step is expected to run `git rev-parse --short=12 HEAD` and pass the result as `PHENOTYPE_GIT_SHA=...` to `cargo build`. The crate documents the contract; it does not enforce it. | A library that shells out to `git` at build time would break offline builds, vendored-dependency builds, and shallow clones. Keep `git` access at the workspace boundary. |

If a caller needs different behaviour (a different fallback string, a different `Display` shape, a non-`&'static str` field), the seam is the same crate: add a new accessor or a new struct field next to the existing ones and have the caller reach for the new symbol. Do not fork the function at the call site.

## Anti-Patterns

- ❌ `env!("CARGO_PKG_VERSION")` + `option_env!("PHENOTYPE_GIT_SHA").unwrap_or("unknown")` + `cfg!(debug_assertions)` + `env!("TARGET")` inlined into a `BuildInfo`-shaped struct — re-implements the four accessors, drifts from the canonical `Display` shape, and silently breaks the day someone wants a different `"unknown"` string.
- ❌ `env!("TARGET")` inside a `pub const` or a `static` initializer in a library — does not compile. Cargo only sets `TARGET` for `build.rs`. Use `phenotype_build_info::version::target_triple()` instead, which is backed by a `build.rs` that lifts the env var into something a library can read.
- ❌ `phenotype_build_info::pkg_version()` used to label *the consuming crate's* own version — it returns the version of the `phenotype-build-info` crate itself, not yours. Use `env!("CARGO_PKG_VERSION")` at the call site, or `phenotype_build_info::build_info()` and accept the caveat.
- ❌ Re-exporting `phenotype_build_info::pkg_version` from a consuming crate under a different name (`pub const VERSION: &str = phenotype_build_info::pkg_version();`) and pretending it is the consuming crate's version — same caveat, easier to miss because of the rename.
- ❌ Hand-rolled `BuildInfo { version, git_sha, profile, target }` struct in a consumer crate — drifts from the canonical `Display` shape, drifts from the `Copy + Hash` derives, and silently breaks if the `phenotype-build-info` crate adds a field. Depend on `phenotype-build-info` and embed its `BuildInfo` directly.
- ❌ `.unwrap()` / `.expect()` on `option_env!("PHENOTYPE_GIT_SHA")` at a call site — the `phenotype_build_info::version::git_sha()` accessor already handles the unset case with the documented `"unknown"` fallback. Re-implementing the `Option` dance at the call site is strictly worse.
- ❌ Branching on `info.git_sha == "unknown"` to decide whether the binary is "real" — treat the string as opaque. A future change to surface `"unknown-sha-N"` for reproducibility, or to embed a dirty-tree marker, would otherwise break you.
- ❌ Shelling out to `git rev-parse` from inside a `build.rs` in a consumer crate — breaks offline builds, vendored-dependency builds, and shallow clones. Keep `git` access at the workspace boundary; pass the SHA in as `PHENOTYPE_GIT_SHA` from CI.
- ❌ `format!("{info}")` with a custom format string at a call site — the canonical `Display` impl is the only sanctioned shape. If you need JSON, build it from the struct's fields; if you need a different human-readable shape, add a new accessor to `phenotype-build-info` and use that.

## Reference Implementation

The single source of truth for the accessors:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:39-41` | `pub const fn pkg_version() -> &'static str` | `env!("CARGO_PKG_VERSION")` for the `phenotype-build-info` crate. Read the [What `pkg_version` returns](#what-pkg_version-returns) warning before using this to label your own version. |
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:62-64` | `pub const fn is_release_build() -> bool` | `!cfg!(debug_assertions)`. |
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:72-78` | `pub const fn build_profile() -> &'static str` | `"debug"` or `"release"`, derived from `cfg!(debug_assertions)`. |
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:86-88` | `pub const fn target_triple() -> &'static str` | `env!("PHENOTYPE_TARGET")`, populated by the crate's `build.rs`. |
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:109-114` | `pub const fn git_sha() -> &'static str` | `option_env!("PHENOTYPE_GIT_SHA")` or the literal `"unknown"`. |
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:136-159` | `pub struct BuildInfo` + `impl Display` | The canonical four-field struct and the canonical `Display` shape. |
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:178-185` | `pub fn build_info() -> BuildInfo` | Composes the four accessors into one value. |
| **phenoShared** | `crates/phenotype-build-info/src/lib.rs:26-30` | `pub mod version; pub use version::{is_release_build, pkg_version, BuildInfo};` | The re-exports that make the crate usable as `phenotype_build_info::pkg_version` (no `version::` prefix). |
| **phenoShared** | `crates/phenotype-build-info/build.rs:16-29` | `fn main()` | Emits `cargo:rustc-env=PHENOTYPE_TARGET={target}` and the `cargo:rerun-if-*` markers. |
| **phenoShared** | `crates/phenotype-build-info/src/version.rs:187-243` | `mod tests` | Inline tests, each annotated with the `FR-VER-00X` requirement it traces to. |

## Migration Checklist (per binary / library)

1. Add `phenotype-build-info = { path = "../phenotype-build-info" }` to `[dependencies]`.
2. Replace any inline `env!("CARGO_PKG_VERSION")` block used to label the *consuming crate's* version with `env!("CARGO_PKG_VERSION")` at the call site (if it isn't already there) — `phenotype_build_info::pkg_version()` is not the right replacement. See [What `pkg_version` returns](#what-pkg_version-returns).
3. Replace any hand-rolled `BuildInfo { version, git_sha, profile, target }` struct (or any `format!("v{} ({} {})", env!(...), cfg!(...), env!(...))` glue) with `phenotype_build_info::build_info()`. Keep the call site focused on the four fields, not on how they're computed.
4. Replace any `env!("TARGET")` inside a `pub const` / `static` initializer in a library with `phenotype_build_info::version::target_triple()`. The former does not compile; the latter does.
5. Replace any `option_env!("PHENOTYPE_GIT_SHA").unwrap_or("unknown")` (or `.unwrap()` / `.expect()`) with `phenotype_build_info::version::git_sha()`. The accessor already implements the documented fallback.
6. Delete any `cfg!(debug_assertions)` check used to gate "is this a release build?" behaviour; reach for `phenotype_build_info::is_release_build()` instead.
7. Delete any `format!`-based build-info log line; reach for `format!("{}", build_info())` (or `Display` directly via `tracing`) so every binary's banner agrees.
8. If a CI step populates `PHENOTYPE_GIT_SHA`, keep it. If not, add one — the crate's contract is that the env var is set by a workspace-level `build.rs` or CI invocation, not by the library itself.

## Related Patterns

- [config-loading](config-loading.md) — sibling "canonical primitive" pattern: timeouts and typed errors live in one crate, called from every consumer.
- [error-handling](error-handling.md) — `BuildInfo` is the natural envelope to attach to every error log line; embed it via `tracing` fields, not via `format!` in the `Display` impl.
- [logging](logging.md) — the structured-log contract for build metadata is the `BuildInfo` struct's four fields, spread as `tracing` fields. The `Display` impl is for human-readable banners and `/healthz` responses, not for log lines.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-build-info` is the org's wrapper around `env!` / `option_env!` / `cfg!` / `TARGET`. Don't reach past it.
- [architecture/hexagonal](architecture/hexagonal.md) — build metadata is a *port*: the `BuildInfo` struct is the type the rest of the binary depends on, the `build.rs` + env vars are the adapter that populates it.

## References

- [`env!` macro](https://doc.rust-lang.org/std/macro.env.html) — the macro `pkg_version` and `target_triple` wrap.
- [`option_env!` macro](https://doc.rust-lang.org/std/macro.option_env.html) — the macro `git_sha` wraps.
- [`cfg!` macro](https://doc.rust-lang.org/std/macro.cfg.html) — the macro `is_release_build` and `build_profile` wrap.
- [Cargo build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html) — the `build.rs` reference that documents `cargo:rerun-if-*` and `cargo:rustc-env=`.
- Internal: `phenoShared/crates/phenotype-build-info/src/version.rs` — the accessors this page governs. If you change the public API (new accessor, new struct field, new `Display` shape), update this page in the same PR.
- Internal: `phenoShared/crates/phenotype-build-info/build.rs` — the build script that lifts `TARGET` into `PHENOTYPE_TARGET`. If you change the script (new env var, new marker), update this page in the same PR.
</content>
</invoke>