# Config Loading Pattern

## Overview

Every Rust crate in the org that needs to load typed configuration from disk goes through one function: `phenotype_config_core::config_loader::load_config`. This page is the canonical place that rule lives; it consolidates the "read-then-parse" guidance that was previously implicit in the per-crate `serde_json::from_str(&std::fs::read_to_string(path)?)` blocks scattered across `phenoShared/crates/phenotype-config-core/src/lib.rs` (legacy `FileConfig::load`), the inline parsers in the various `*-adapter` crates, and the hand-rolled `Figment::new().merge(Json::file(path)).extract()` blocks in `HeliosLab`, `PhenoRuntime`, and `KWatch`.

If a crate needs to load config, it imports `load_config`. If a `Cargo.toml` adds `serde_json` + `serde_yaml` + `toml` + `figment` directly to parse a file ad-hoc, either fix the crate or update this page — don't fork the rule. The `phenotype-config-core` crate exists for exactly this reason: one place to own the format auto-detection, the bounded read timeout, the typed `ConfigError`, and the consistent path-in-error contract so every caller gets the same behaviour.

## The Rule

| Context | Use | Crate / Function | Why |
|---------|-----|------------------|-----|
| Any Rust crate that needs to load a typed config from a file (`.json`, `.yaml`, `.yml`, `.toml`) | `phenotype_config_core::config_loader::load_config::<T>(path)` | `phenotype-config-core` | One function owns format auto-detection, a 5 s read timeout (so a hung filesystem can never stall service startup), and a typed `ConfigError` whose **every variant includes the originating file path**. |
| Test that needs a typed config from a temp file | `phenotype_config_core::config_loader::load_config::<T>(path)` | `phenotype-config-core` | Same factory in tests keeps the path-in-error and timeout contract; if you need a fake, use an in-memory `serde_json::json!()` and `serde_json::from_value`, not a hand-rolled reader. |
| Config that arrives from a non-file source (env-only, in-memory, fetched at runtime) | `phenotype_config_core::{EnvConfig, FileConfig, merge_configs}` (the layer beneath `load_config`) | `phenotype-config-core` | The `ConfigLoader` trait + `merge_configs` helper is the seam for multi-source composition. Reach for it only when `load_config`'s file-only contract doesn't fit; never go around it for plain file loading. |

**Hard rule:** `std::fs::read_to_string(path)?` followed by `serde_json::from_str` / `serde_yaml::from_str` / `toml::from_str` is forbidden in Phenotype code. The defaults are wrong for us: no read timeout (a hung filesystem hangs service startup), no format auto-detection (every call site re-implements `ConfigFormat::from_path`), and the error message has no originating path attached (the caller has to wrap the error to find out which file failed).

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-config-core = { path = "../phenotype-config-core" }

# Note: do NOT add `serde_json` + `serde_yaml` + `toml` + `figment` directly
# in a consumer crate just to parse a config file. Consumers go through
# `load_config()` and the crate-local error type; they never touch the
# parsers themselves. Add the parsers as direct deps only if you are
# building a serde `Deserialize` impl that needs them as a transitive
# `serde` feature, or if you are extending `phenotype-config-core`.
```

### Use the factory

```rust
// crates/<name>/src/config.rs
use std::path::{Path, PathBuf};
use serde::Deserialize;
use crate::error::<Crate>Error;

/// Typed application configuration loaded once at startup.
#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub name: String,
    pub port: u16,
    #[serde(default)]
    pub tags: Vec<String>,
    pub database: DatabaseConfig,
}

#[derive(Debug, Deserialize)]
pub struct DatabaseConfig {
    pub host: String,
    pub port: u16,
}

/// Loads `AppConfig` from the file at `path`.
///
/// Format (`.json` / `.yaml` / `.yml` / `.toml`) is auto-detected from
/// the file extension. The read is bounded by `LOAD_TIMEOUT` (5 s).
/// On any failure the returned `ConfigError` includes the originating
/// `path` in every variant, so call sites can log it without an extra
/// `.map_err`.
pub fn load_app_config(path: &Path) -> Result<AppConfig, <Crate>Error> {
    phenotype_config_core::config_loader::load_config::<AppConfig>(path)
        .map_err(<Crate>Error::from)
}

/// Resolves the config path from CLI args, falling back to a conventional
/// default. Keep this tiny — don't reach into the env here; that's the
/// caller's job (see [Stack defaults](../stack/defaults.md) on `.env`).
pub fn resolve_config_path(cli: Option<PathBuf>) -> PathBuf {
    cli.unwrap_or_else(|| PathBuf::from("config/app.yaml"))
}
```

### In a binary's `main`

```rust
// crates/<name>/src/main.rs (binary)
use std::process::ExitCode;
use crate::config::{load_app_config, resolve_config_path};

fn main() -> ExitCode {
    let path = resolve_config_path(std::env::args().nth(1).map(Into::into));
    let cfg = match load_app_config(&path) {
        Ok(cfg) => cfg,
        Err(err) => {
            // ConfigError's Display always includes the path; print
            // straight to stderr and exit non-zero. Do NOT `.unwrap()`
            // and panic — the typed error is the whole point of the
            // factory.
            eprintln!("{err}");
            return ExitCode::FAILURE;
        }
    };
    run_service(cfg);
    ExitCode::SUCCESS
}
```

Conventions (lifted from `phenoShared/crates/phenotype-config-core/src/config_loader.rs:84-162`):

- `load_config` takes `&Path`, not `&str` — `Path` is the org default for filesystem surfaces. Convert with `Path::new("config/app.json")` or `PathBuf::from(...)` at the boundary.
- The return type is `Result<T, ConfigError>`; convert into your crate-local `<Crate>Error` with `#[from]` (see [error-handling](error-handling.md)) so the rest of the binary keeps one error type. Never re-export `ConfigError` from your crate's public API.
- The generic bound is `T: DeserializeOwned + Send + 'static` — the `Send + 'static` is required because the inner worker thread owns the value during the bounded read. Don't try to be clever and pass a `!Send` type; the compiler will tell you.
- Don't pre-check the file with `Path::exists()` before calling `load_config` — it adds a TOCTOU race and the factory's `ConfigError::Io { path, source }` is already path-tagged. The path tag is the source of truth.

## What `load_config` Configures

The factory is the single place that owns these defaults; consumers must not duplicate them:

| Setting | Value | Why |
|---------|-------|-----|
| Format auto-detection | `.json` → `figment::Json`, `.yaml` / `.yml` → `serde_yaml`, `.toml` → `toml` | One `match` on the file extension, one set of parser dependencies, one set of error variants. Call sites never write `if path.ends_with(".yaml")`. |
| Read timeout | `LOAD_TIMEOUT` = 5 s wall-clock, enforced by off-loading the read to a worker thread + `mpsc::sync_channel(1).recv_timeout(...)` | A hung filesystem (NFS stall, container with a stuck volume mount) must not be able to block service startup indefinitely. The factory surfaces a `ConfigError::Timeout { path, timeout_secs }` instead. |
| Worker thread name | `"phenotype-config-loader"` | Identifies the thread in `tokio_console` / `pprof` / `kill -3` dumps, so an operator can tell at a glance which subsystem a stuck thread belongs to. |
| Error contract | Every `ConfigError` variant carries the originating `path: String`; a `path()` accessor returns `&str` for callers that want to log or re-wrap | Call sites log the error verbatim; no `.map_err(|e| format!("{path}: {e}"))` shims. |
| Detached JoinHandle on timeout | `let _ = worker_handle;` — the worker is intentionally not joined on timeout | `JoinHandle::join()` would itself block; detaching is the documented shape for a timeout-bounded blocking operation in a sync context. |
| Panicking worker | `RecvTimeoutError::Disconnected` (worker panicked) is surfaced as a `ConfigError::Timeout { path, timeout_secs }` | The path is the actionable part; the original panic message is intentionally lost. If you find yourself wanting it, the fix is to fix the panic, not to surface it. |

If a caller needs different behaviour (a different timeout, a custom format, a non-file source), the seam is the `ConfigLoader` trait + `merge_configs` helper in the same crate — extend `phenotype-config-core` and reuse the `ConfigError` shape, do not fork the function at the call site.

## Anti-Patterns

- ❌ `std::fs::read_to_string(path)?` + `serde_json::from_str(&content)?` — bare defaults, no timeout, no path-in-error. This is the exact thing the pattern forbids.
- ❌ `Figment::new().merge(Json::file(path)).extract::<T>()` inlined in a consumer crate — duplicates the format-detection logic, drifts from the org's error contract, and silently changes the timeout behaviour if the figment version bumps.
- ❌ Adding `serde_json` + `serde_yaml` + `toml` + `figment` as direct dependencies in a consumer crate just to parse a single config file. Depend on `phenotype-config-core` instead.
- ❌ `Path::exists()` / `Path::is_file()` checks before calling `load_config` — TOCTOU race, and the factory's `ConfigError::Io { path, .. }` is already path-tagged. Pre-checking is strictly worse.
- ❌ `.unwrap()` / `.expect()` on the `load_config` result in a production code path — the typed `ConfigError` exists precisely so you can match / log / convert. `.expect()` re-introduces the panic the pattern is designed to remove.
- ❌ Reading the same file twice (once for "schema sanity check", once for real load) — `load_config` is the only call. If you need validation beyond `Deserialize`, implement `ValidateConfig` and call it after the single load.
- ❌ Hand-rolling a "config loader trait" in a consumer crate when `phenotype_config_core::ConfigLoader` + `merge_configs` already exist. The trait is the seam; reach for it.
- ❌ Stripping the `path` from `ConfigError` when re-wrapping it into `<Crate>Error` — the path is the actionable part of the message. Use `#[from]` and let it bubble.

## Reference Implementation

The single source of truth for the factory:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-config-core/src/config_loader.rs:84-162` | `pub fn load_config<T: DeserializeOwned + Send + 'static>(path: &Path) -> Result<T, ConfigError>` | Defines format auto-detection, the 5 s `LOAD_TIMEOUT`, the worker-thread + bounded-channel shape, the `ConfigError` variants, and the `path()` accessor. |
| **phenoShared** | `crates/phenotype-config-core/src/config_loader.rs:42-82` | `pub enum ConfigError` + `impl ConfigError` | `thiserror` enum with six variants (`UnsupportedExtension`, `Timeout`, `Io`, `Figment`, `Yaml`, `Toml`); every variant carries `path: String`. Follows the [error-handling](error-handling.md) pattern. |
| **phenoShared** | `crates/phenotype-config-core/src/config_loader.rs:30-35` | `pub const LOAD_TIMEOUT: Duration` | The 5 s bound. Single constant, referenced from both `load_config` and the test suite. |
| **phenoShared** | `crates/phenotype-config-core/src/lib.rs:51-257` | `ConfigLoader` trait, `ConfigSource`, `EnvConfig`, `FileConfig`, `merge_configs` | The seam for multi-source composition (env + file, layered files, etc.). Use this when `load_config`'s file-only contract doesn't fit — never go around it. |

The legacy shape (a migration candidate, not a reference for new code):

| Repo | Path | Issue |
|------|------|-------|
| **phenoShared** | `crates/phenotype-config-core/src/lib.rs:155-226` (legacy `FileConfig`) | `FileConfig::load<T>` reads + parses without a timeout, returns `FileConfigError` whose variants don't always carry the path, and re-implements the format-detection table. Migrate call sites to `config_loader::load_config`; keep the `ConfigLoader` trait impl. |

## Migration Checklist (per crate)

1. Remove `serde_json` + `serde_yaml` + `toml` + `figment` from `[dependencies]` *if* they were only there to parse a config file (keep them as transitive deps if you need the `serde` types in your domain model).
2. Add `phenotype-config-core = { path = "../phenotype-config-core" }`.
3. Replace every `std::fs::read_to_string(path)?` + `*::from_str(&content)?` block with `phenotype_config_core::config_loader::load_config::<MyConfig>(path)`.
4. Convert the factory's `Result<T, ConfigError>` into your crate-local error via `#[from]` (see [error-handling](error-handling.md)) — the `path` field must survive the conversion intact.
5. Delete any `Path::exists()` / `Path::is_file()` pre-check; the factory's typed error is the source of truth.
6. If your crate exposes a `pub fn load_config` in its public API, re-export the symbol from `phenotype-config-core` or take a `&Path` parameter and call the factory internally — do not rebuild the function.

## Related Patterns

- [error-handling](error-handling.md) — how to wrap `ConfigError` into a crate-local `<Crate>Error` via `#[from]`, and why the `path` field must survive the conversion.
- [architecture/hexagonal](architecture/hexagonal.md) — config is a *port*; the file-based loading is one *adapter*. The `ConfigLoader` trait + `merge_configs` is the port; `load_config` is a concrete adapter. Use the port when you need a non-file source.
- [http-client](http-client.md) — sibling "canonical primitive" pattern: timeouts and typed errors live in one place, called from every consumer.
- [logging](logging.md) — the `ConfigError::path` is exactly the field that should be on the structured log line when config load fails (`tracing::error!(path = %err.path(), "config load failed")`).
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-config-core` is the org's wrapper around `serde_json` + `serde_yaml` + `toml` + `figment`. Don't reach past it.
- [stack/defaults](../stack/defaults.md) — `.env` + `PHENO_*` env vars + a config file are the standard layered setup; `load_config` is the file half, `EnvConfig` is the env half, `merge_configs` joins them.

## References

- [`serde` docs](https://docs.rs/serde) — the `Deserialize` derive used by every typed config.
- [`figment` docs](https://docs.rs/figment) — the JSON provider the factory delegates to (kept as a transitive dep; consumers do not name it).
- [`serde_yaml` docs](https://docs.rs/serde_yaml) — YAML parser the factory delegates to.
- [`toml` docs](https://docs.rs/toml) — TOML parser the factory delegates to.
- Internal: `phenoShared/crates/phenotype-config-core/src/config_loader.rs` — the factory this page governs. If you change the public API, update this page in the same PR.
