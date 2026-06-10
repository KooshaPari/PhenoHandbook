# Logging Pattern

## Overview

Phenotype code emits **structured** log events — keyed fields, not interpolated strings — and routes them through one of two canonical helpers: `phenotype_logging::init_tracing` for Rust, `log/slog` with a JSON handler for Go. This page is the single source of truth for that rule. It consolidates the `tracing` / `slog` guidance that was previously inlined in `SPEC.md` (Observability section), in the `crates/phenotype-logging` crate's own README, and across the implicit per-repo `fn main()` blocks in `PhenoRuntime`, `HeliosLab`, `KWatch`, and `MCPForge`.

If a pattern file needs to talk about logging, it links here. If a crate or binary logs differently from this page, either fix the code or update this page — don't fork the rule.

## The Rule

| Context | Use | Crate / package | Why |
|---------|-----|-----------------|-----|
| Rust library crate | `tracing` macros (`info!`, `warn!`, `error!`, `debug!`, `trace!`) with **typed fields**, no `format!` interpolation of context | `tracing` | Subscribers (fmt, JSON, OTLP) attach fields as structured attributes; interpolating them at the call site loses the shape. |
| Rust binary / integration test / example | Same `tracing` macros, initialized once via `phenotype_logging::init_tracing()` (or `init_tracing_with_default` / `init_tracing_for_test`) | `phenotype-logging` (re-exports `tracing` + `tracing_subscriber`) | One helper, idempotent (`try_init`), honors `RUST_LOG`, no copy-pasted 7-line subscriber block at the top of every `main.rs`. |
| Go library / server | `log/slog` (package-level `slog.Info`, `slog.Error`, …) with **key/value attributes**, default handler installed at process start | stdlib `log/slog` (Go 1.21+) | JSON handler is the default; fields become first-class JSON keys; no `fmt.Sprintf` soup in the log line. |
| Go CLI subcommand | `log/slog` (same as above) — never `log.Printf` / `fmt.Println` | stdlib `log/slog` | `log.Printf` flattens every field into the message string and breaks log-shipping parsers. |

Two consequences:

- **Never** `println!` / `eprintln!` / `fmt.Println` / `log.Printf` in production code paths. Reserve those for test fixtures and one-off scripts outside the workspace.
- **Never** call `tracing_subscriber::fmt().init()` inline in a `main.rs` — use the `phenotype-logging` helper so `RUST_LOG` handling, default filter, and `try_init` semantics are consistent across every binary.

## Canonical Shapes

### Rust — `phenotype-logging` helper

`phenoShared/crates/phenotype-logging/src/lib.rs` exposes three entry points; pick by call site:

```rust
// crates/<name>/src/main.rs
use phenotype_logging::init_tracing;

fn main() {
    init_tracing();
    // ...
    tracing::info!(path = %path, "loaded config");
}
```

```rust
// crates/<name>/src/main.rs — override the default filter
use phenotype_logging::init_tracing_with_default;

fn main() {
    init_tracing_with_default("debug,sqlx=warn");
    // ...
}
```

```rust
// crates/<name>/tests/integration.rs — keep the global subscriber untouched
use phenotype_logging::init_tracing_for_test;

#[test]
fn capture_emits() {
    let _guard = init_tracing_for_test("info");
    tracing::info!("captured for the lifetime of `_guard`");
}
```

Conventions (all from `phenotype-logging/src/lib.rs:54-103`):

- `init_tracing` is **idempotent** — it uses `try_init` internally, so a second call in the same process is a no-op (not a panic). This is what makes it safe to call from multiple integration test binaries linked into one test runner.
- `RUST_LOG` takes precedence when set; the helper falls back to `DEFAULT_FILTER = "info"` otherwise.
- The subscriber is `tracing_subscriber::fmt().with_env_filter(...).with_target(false)`. `with_target(false)` is intentional — the JSON handler adds it as a field automatically; the fmt handler's prefix is noise.
- For scoped setup in tests, use `init_tracing_for_test` and bind the returned `DefaultGuard` to the test scope. Drop restores the previous global subscriber.

### Rust — call sites

Always pass **structured fields**, never an interpolated string:

```rust
// ✅ Good — fields are first-class
tracing::info!(user_id = %user.id, tenant = %user.tenant, "loaded user");
tracing::warn!(retries = 3, backoff_ms = 250, "retrying after transient error");
tracing::error!(error = ?err, request_id = %req_id, "request failed");

// ❌ Bad — context is inlined into the message; the subscriber can't index it
tracing::info!("loaded user {} for tenant {}", user.id, user.tenant);
```

Render conventions:

- `Display`-able values use `%` (`user_id = %user.id`).
- `Debug`-only values use `?` (`error = ?err`).
- Numeric / bool / `&'static str` use neither (`retries = 3`, `dry_run = true`).

### Go — `log/slog` with a JSON handler

`KWatch/server/server.go:13-31` is the canonical shape:

```go
package server

import (
    "log/slog"
    "os"
    "sync"
)

// loggerInit guards one-time installation of the default slog handler so
// repeated calls to New() (e.g. in tests) don't churn the global logger.
var loggerInit sync.Once

// setupLogger installs a JSON-based slog handler on the package's default
// logger. Output goes to stderr to preserve the historical log.Printf
// destination. The handler is tagged with a "service" attribute so log
// shippers can route KWatch events alongside the rest of the phenotype
// fleet. Safe to call multiple times.
func setupLogger() {
    loggerInit.Do(func() {
        handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
            Level: slog.LevelInfo,
        })
        slog.SetDefault(slog.New(handler).With(
            slog.String("service", "kwatch"),
        ))
    })
}
```

Conventions (lifted from `KWatch/server/server.go:73-83`):

- The handler is **JSON**, written to **stderr**, at `LevelInfo` by default.
- `SetDefault` is called once per process, guarded by `sync.Once` so tests that re-construct the server don't churn the global logger.
- A `service` attribute is bound at install time via `slog.With(...)` so every log line carries it without the call site having to remember.
- Call sites use key/value attributes, not `Sprintf`:

```go
// ✅ Good
slog.Info("starting kwatch HTTP server",
    "host", s.config.Host,
    "port", s.config.Port,
)
slog.Info("available endpoints",
    "base_url", baseURL,
    "endpoints", []map[string]string{ /* ... */ },
)

// ❌ Bad — fields are baked into the message string
slog.Info(fmt.Sprintf("starting kwatch HTTP server on %s:%d", s.config.Host, s.config.Port))
log.Printf("starting kwatch HTTP server on %s:%d", s.config.Host, s.config.Port)
```

## Reference Implementations (2+ example repos)

| Repo | File | Pattern |
|------|------|---------|
| **phenoShared** | `crates/phenotype-logging/src/lib.rs:54-103` | The canonical `init_tracing` / `init_tracing_with_default` / `init_tracing_for_test` helpers. Doc-comments name the same callers we use today (`PhenoRuntime`, `PhenoAgent`, `PhenoMCP-cheap`, `HeliosLab`). FR-LOG-001..003 map 1:1 to the three public functions. |
| **HeliosLab** | `pheno-cli/src/main.rs:140-141` | `fn main()` calls `tracing_subscriber::fmt::init();` — the inline pre-`phenotype-logging` shape. New `pheno-cli` binaries should migrate to `init_tracing` (see [Anti-Patterns](#anti-patterns)). |
| **PhenoRuntime** | `crates/pheno-nats/src/lib.rs:13`, `crates/pheno-minio/src/lib.rs` | `use tracing::{debug, info};` at the top of every infra adapter; macros are called with typed fields, not `format!`. |
| **KWatch** | `server/server.go:13-31, 73-83` | Canonical Go pattern: `sync.Once` + `slog.NewJSONHandler(os.Stderr, …)` + `service` attribute, key/value call sites throughout `Start` and `printEndpoints`. |
| **KWatch** *(in-progress)* | `cmd/daemon.go:118-141`, `cmd/run.go:235-241` | Still uses `fmt.Println` / `log.Printf` / `log.Fatalf` in CLI subcommands. Migration candidate — see [Anti-Patterns](#anti-patterns). |
| **MCPForge** | `internal/logging/logger.go` | Legacy `*log.Logger` adapter with a `Component` discriminator and `LOG_LEVEL` / `LOG_COMPONENT_LEVELS` env knobs. Functional, but predates `log/slog`. Track migration in the MCPForge observability audit; do not duplicate the shape in new services. |

The "X repos do this, Y repos do that" picture (see `SPEC.md` Observability section for the wider pattern-compliance matrix) is concrete here:

- ✅ **phenoShared, PhenoRuntime, HeliosLab (`pheno-cli`)** — `tracing` macros, typed fields, JSON-friendly.
- ✅ **KWatch (`server/`)** — `log/slog` with JSON handler, `sync.Once` guard, `service` attribute.
- ⚠️ **KWatch (`cmd/`)** — partially migrated; CLI subcommands still call `fmt.Println` / `log.Printf`. Track in the KWatch observability audit, do not duplicate the legacy `*log.Logger` shape from MCPForge in new repos.

## Anti-Patterns

- ❌ `println!` / `eprintln!` / `fmt.Println` in any production code path — untyped, unfilterable, breaks `RUST_LOG` / `LOG_LEVEL`.
- ❌ `log.Printf` / `log.Fatalf` / `log.Println` in any Go code path that ships — flattens fields into the message and breaks JSON log parsers. Reserve for one-off scripts and `main` bootstrap *only* during the migration window.
- ❌ `tracing_subscriber::fmt().init()` inlined into a `main.rs` — duplicates the helper, drifts from `RUST_LOG` semantics, and panics on a second call in the same process. Use `phenotype_logging::init_tracing`.
- ❌ Interpolated context inside a log message — `tracing::info!("loaded user {user}")` and `slog.Info(fmt.Sprintf("loaded user %s", id))` both lose the structured shape. Always pass fields.
- ❌ Custom `*log.Logger` / homegrown `Logger` interface in a new Go service — use stdlib `log/slog`. The MCPForge `internal/logging` package is a documented exception for the migration window, not a template.
- ❌ Re-installing the global subscriber on every test or request — call `init_tracing` / `setupLogger` once per process and let `sync.Once` (Go) or `try_init` (Rust) keep it idempotent.

## Related Patterns

- [error-handling.md](error-handling.md) — error variants get logged at the boundary; structured fields on the log line are how the `?` bubble-up becomes machine-parseable, not a string.
- [architecture/hexagonal.md](architecture/hexagonal.md) — adapter logs carry the adapter's `port_name` so log shippers can route by component; domain code logs without knowing the adapter exists.
- `SPEC.md` Observability section — the original Guidelines Catalog entries this page promotes to a standalone pattern.

## References

- [`tracing` crate docs](https://docs.rs/tracing) — span / event / field reference.
- [`tracing-subscriber` crate docs](https://docs.rs/tracing-subscriber) — `EnvFilter`, `fmt`, `with_target` reference.
- [`log/slog` package docs](https://pkg.go.dev/log/slog) — JSON / Text handlers, `SetDefault`, attribute reference.
- Internal: `phenoShared/crates/phenotype-logging/src/lib.rs` — the helper itself; if you change the public API, update this page in the same PR.
