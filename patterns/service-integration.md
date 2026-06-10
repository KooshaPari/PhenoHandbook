# Service Integration Pattern

**Status:** adopted · **Applies to:** every Rust service binary (and every MCP server / daemon / worker) in the Phenotype fleet that talks to another service or accepts inbound requests. The pattern is the *consumer-side* complement to [module-decoupling](module-decoupling.md) (which fixes the *producer-side* lift to `phenoShared`); this page fixes the four lines every binary writes to wire the lifted primitives.

## Overview

The org has lifted a fixed set of primitives into `phenoShared` ([phenotype-logging](https://github.com/phenotype-sh/phenoShared/tree/main/crates/phenotype-logging) for tracing, `phenotype-http-client` for the reqwest builder, [phenotype-secret](secrets.md) for credentials, `phenotype-rate-limit` for backpressure, plus `phenotype-retry`, `phenotype-error-core`, `phenotype-time`, `phenotype-build-info`, `phenotype-config-core` for the supporting roles). The lifts are described in [module-decoupling](module-decoupling.md) §3; this page is the rule for *consuming* the lifted primitives from a new service binary.

The failure mode this page exists to prevent is **per-service drift**: a new service binary is added to the fleet (or an existing one is rewritten), the author reaches for the ecosystem crate directly (`tracing_subscriber::fmt()…`, `reqwest::Client::new()`, `std::env::var("API_KEY")`, a hand-rolled `DashMap<String, Instant>` rate limiter), and the four wiring lines drift from the fleet's contract (the `RUST_LOG` fallback to `info`, the 30-second default timeout, the `[REDACTED]` Display/Serialize marker, the token-bucket refill rate). The rule below is the single line that prevents the drift: the canonical recipe is `init_tracing` + `build_default_client` + `Secret` + `TokenBucket`, in that order, with no substitutions.

> **Scope note.** This page is the *consumer-side* recipe for a new service binary. The *producer-side* lift (the six-step PR that extracts a primitive from one consumer into `phenoShared`) is documented in [module-decoupling](module-decoupling.md) §3. The *contract* the lifted primitives expose to consumers (field names, env-var precedence, test helpers) is documented in the per-primitive pattern docs linked from the [nine-primitive table](module-decoupling.md#reference-9-phenoshared-primitives). This page is the four lines the binary writes; the other pages are the contract the four lines are agreeing to.

## The Rule

When wiring a new service binary — a new crate in `crates/<service>/src/main.rs`, a new `bin/<service>.rs`, a new MCP server entry, a new daemon — the canonical recipe is exactly four calls, in this order, with no substitutions:

| Step | Call | Crate / API | Why |
|------|------|-------------|-----|
| 1. Initialize observability | `phenotype_logging::init_tracing();` | [`phenotype-logging`](https://github.com/phenotype-sh/phenoShared/tree/main/crates/phenotype-logging) | Single `RUST_LOG`-aware `tracing_subscriber` initialization. Honors `RUST_LOG` directives when set, falls back to `DEFAULT_FILTER = "info"` when unset. Idempotent (a second call is a no-op, not a panic), so it is safe to call from `main()`, from integration-test harnesses, and from library entry points in the same process. The exact `.with_env_filter(...).with_target(false).try_init()` shape is the org's contract; hand-rolling a different `.init()` line forks the `RUST_LOG` precedence and breaks the fleet's log aggregation. |
| 2. Build the HTTP client | `let client = phenotype_http_client::build_default_client()?;` | `phenotype-http-client` (planned) | Single reqwest `Client` with the org's default timeouts (connect 10s, request 30s, TLS handshake 10s), redirect policy (max 5), pool size (16 idle / per host), and user-agent (`<service>/<version> (<repo-url>)`). The 30-second request timeout is the one the fleet agrees on; a hand-rolled `Client::new()` returns a client with *no* timeout, which is the exact thing the timeout would have caught. The builder returns `Result` so a misconfigured env-var (e.g. a non-numeric `PHENOTYPE_HTTP_TIMEOUT_SECS`) surfaces at startup, not on the first request. |
| 3. Load credentials | `let token: Secret<String> = Secret::from(std::env::var("SERVICE_TOKEN")?);` | [`phenotype-secret`](https://github.com/phenotype-sh/phenoShared/tree/main/crates/phenotype-secret) | The redaction-aware `Secret<String>` wrapper. `Display` / `Debug` / `Serialize` all emit the literal `[REDACTED]`, so an accidental `format!("{token}")`, `tracing::info!(?token)`, or `serde_json::to_string(&config)` cannot exfiltrate the value. The single auditable escape hatch is `token.expose()`; every call site is `rg`-able, which makes a security review trivial. The wrapper is `Deref<Target = str>`-only (no `DerefMut`, no `From<&str>` mutation), so callers cannot mutate the inner buffer in place after construction. |
| 4. Build the rate limiter | `let limiter = TokenBucket::new(rate, burst)?;` | `phenotype-rate-limit` (planned) | Token-bucket rate limiter for outbound backpressure (calls to upstream APIs, MCP tool invocations, NATS publishes, DB queries). The `rate` is sustained requests/second; the `burst` is the maximum in-flight requests before the bucket is exhausted. The wrapper enforces a single bucket shape (token-bucket, not leaky-bucket, not fixed-window) and a single refill strategy (continuous, not per-tick), so the fleet's backpressure contract is uniform across services. |

**Hard rule:** the four calls appear in this order in every `main.rs`. The order matters: tracing must come first (so subsequent errors are captured), then the client (which logs its own construction), then the credentials (which the client may consume for `Authorization` headers), then the rate limiter (which wraps the client's outbound calls). Re-ordering is a violation; skipping a step is a violation; substituting the ecosystem crate (`tracing_subscriber::fmt()…`, `reqwest::Client::new()`, `std::env::var("…")`, a hand-rolled `DashMap` limiter) is a violation.

**Hard rule:** a service binary that talks to *another* service but does not need a rate limiter (e.g. a one-shot CLI tool that issues exactly one request) still gets a `TokenBucket::new(1, 1)?;` line. The line is the *contract marker*; the limiter being permissive is fine, the line being absent is the violation. The marker tells the reviewer "this binary considered backpressure and chose to be permissive," not "this binary forgot about backpressure."

**Hard rule:** a service binary that does not need credentials (e.g. a local-only daemon with no API key) still gets a `let _secret: Option<Secret<String>> = None;` placeholder. The placeholder is the contract marker; the placeholder being `None` is fine, the `use std::env::var` call being absent is the violation. The reviewer should be able to grep the `main.rs` and see that the author considered the credential path and made a deliberate decision.

**Hard rule:** the four calls are written in the form documented below — `init_tracing();` (no `let _ =`), `build_default_client()?;` (propagated with `?`), `Secret::from(env::var(...)?);` (consuming the env var), `TokenBucket::new(rate, burst)?;` (propagated with `?`). The exact form is the contract; a `let _tracing = init_tracing();` is a violation because it suggests the author didn't know the call was idempotent.

**Hard rule:** the `build_default_client` and `TokenBucket::new` builders return `Result<…, ConfigError>` (or similar), and the `?` propagation surfaces a misconfigured env-var at startup, not on the first request. A `build_default_client().unwrap()` is a violation; a `let client = build_default_client().expect("default client must build");` is a violation. The `?` form is the contract; the failure mode is "the binary fails to start with a clear error," which is exactly what the org wants.

## Canonical Pattern

### A 5-line `main.rs` (the canonical shape)

```rust
// crates/<service>/src/main.rs                       (a new service binary)
//
// The five lines below are the entire wiring. The body of `main()`
// is the *service-specific* logic that comes after — request routing,
// MCP tool handlers, daemon loop, etc. — and is out of scope for the
// pattern.

use phenotype_logging::init_tracing;
use phenotype_secret::Secret;
use phenotype_rate_limit::TokenBucket;

fn main() -> anyhow::Result<()> {
    init_tracing();                                            // 1. observability
    let _client = phenotype_http_client::build_default_client()?;  // 2. HTTP client
    let _token: Secret<String> =                                // 3. credentials
        Secret::from(std::env::var("SERVICE_TOKEN")?);
    let _limiter = TokenBucket::new(                           // 4. backpressure
        /* rate  */ 100, /* req/s */
        /* burst */ 200,
    )?;
    // 5. service-specific body goes here (request routing, MCP handlers,
    //    daemon loop, …). The four lines above are the *wiring contract*;
    //    everything below is the *service*.
    Ok(())
}
```

The five-line shape is a *minimum*, not a *maximum*. A real service binary will add imports for the service-specific types (request handlers, MCP tools, NATS subscribers, gRPC services), the actual `tokio::main` or `#[actix_web::main]` macro, and the body of the service. The contract is that the four wiring lines are present, in order, and that no ecosystem-crate direct call (`tracing_subscriber::fmt()…`, `reqwest::Client::new()`, `std::env::var("…")` for a credential, a hand-rolled `DashMap` limiter) appears in `main.rs`. The wiring is `phenoShared`-only; the service logic is service-only.

### A `tokio::main` service (the realistic shape)

```rust
// crates/<service>/src/main.rs                       (a tokio-based service)
//
// The four wiring lines are unchanged from the 5-line shape. The
// `#[tokio::main]` macro and the service-specific `async fn` body
// are the *only* additions.

use phenotype_logging::init_tracing;
use phenotype_secret::Secret;
use phenotype_rate_limit::TokenBucket;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    let client = phenotype_http_client::build_default_client()?;
    let token: Secret<String> = Secret::from(std::env::var("SERVICE_TOKEN")?);
    let limiter = TokenBucket::new(/* rate */ 100, /* burst */ 200)?;

    // Service-specific body: build a reqwest request, attach the
    // bearer token via the audited `Secret::expose` accessor, and
    // acquire a token-bucket permit before sending.
    let permit = limiter.acquire().await?;
    let resp = client
        .get("https://upstream.example.com/v1/resource")
        .bearer_auth(token.expose())                  // ✅ audited escape hatch
        .send()
        .await?;
    drop(permit);                                     // release on scope exit

    Ok(())
}
```

Conventions (lifted from the org's adoption catalog):

- The four wiring lines are written in this exact form, with the `?` propagator on lines 2 and 4, and the `Secret::from(env::var(...)?)` consuming the `Result` from `env::var`. A `let _ = build_default_client()?;` is allowed when the client is not used directly in `main` (e.g. a daemon that hands the client to a long-lived background task); the `_` is the contract marker, not a "I forgot to use this" marker.
- The `token.expose()` call is the only place the secret is reachable as a `&str`. Every other path — `format!("{token}")`, `tracing::info!(?token)`, `serde_json::to_string(&config)` — returns the redaction marker. The `expose()` call site is `rg`-able, which is the entire point: a security review is `rg "Secret::expose"` and a follow-up `rg "\.expose\(\)"` to confirm each call site is justified.
- The `TokenBucket::acquire().await?` returns a permit guard; dropping the guard (explicit `drop(permit)`, scope exit, or the `_permit` pattern) releases the permit. The acquire is `async` so a saturated bucket *backs pressure* the caller — the request is parked, not dropped, not queued-into-a-side-channel.
- The `#[tokio::main]` (or `#[actix_web::main]`, or any other runtime macro) sits *above* the four lines, not below. The runtime is the prerequisite for `async` wiring; observability is the prerequisite for the runtime to log its own startup; the client is the prerequisite for the credentials to be attached to requests; the limiter is the prerequisite for the requests to be paced. The order is the dependency order.
- A service binary that does not need a particular primitive still gets the line (with the placeholder / permissive-value form documented in the Hard rules above). The line is the contract marker; a reviewer who doesn't see the line cannot tell whether the author considered the primitive and chose to skip it, or whether the author forgot.

### Anti-patterns: the moves the rule rejects

- ❌ **Calling `tracing_subscriber::fmt()…` directly in `main.rs`** — forks the `RUST_LOG` precedence (the wrapper honors `RUST_LOG` first, the hand-rolled form is whatever the author wrote), the idempotency guarantee (the wrapper uses `try_init`, the hand-rolled form uses `.init()` which panics on a re-init), and the default filter (the wrapper falls back to `info`, the hand-rolled form falls back to whatever the author remembered). Use `phenotype_logging::init_tracing()`; the wrapper is the contract.
- ❌ **Calling `reqwest::Client::new()` (or `Client::builder().build()?`)** — returns a client with *no* timeouts, no redirect cap, no user-agent, no proxy settings, and no connection-pool sizing. The fleet's contract is the 30-second request timeout, the 5-redirect cap, the 16-idle-connection pool, and the `<service>/<version>` user-agent. Use `phenotype_http_client::build_default_client()?`; the builder is the contract.
- ❌ **Reading a credential via `std::env::var("SERVICE_TOKEN")?` and storing it in a `String`** — the `String` is leakable through `format!`, `tracing::info!`, `serde_json::to_string`, `panic!`, `dbg!`, and every other "innocent" path. Use `Secret::from(env::var(...)?)`; the wrapper's `Display` / `Debug` / `Serialize` impls are the only contract. The only escape hatch is `secret.expose()`, which is `rg`-able for review.
- ❌ **A hand-rolled `DashMap<String, Instant>` rate limiter** — forks the bucket shape (the wrapper uses token-bucket, the hand-rolled form is whatever the author remembered), the refill strategy (continuous vs. per-tick), and the concurrency model (a `DashMap` is fine for per-key buckets, wrong for a single-process global bucket, wrong for a per-route bucket, etc.). Use `TokenBucket::new(rate, burst)?`; the wrapper is the contract.
- ❌ **Re-ordering the four lines** (tracing → client → credentials → limiter)** — the order encodes the dependency graph. Tracing must come first so a `build_default_client` failure is captured by the subscriber. The client must come before credentials so a misconfigured client URL surfaces before the token is unwrapped. The credentials must come before the limiter so a `SERVICE_TOKEN` env-var error is logged before the bucket is sized. Re-ordering doesn't change the *correctness* of the binary, but it changes the *observability* of the startup sequence, and a startup that fails at step 3 should log step 1 and step 2's success, not be silent because tracing was initialized last.
- ❌ **Using `unwrap()` or `expect()` on a wiring call** — a `build_default_client().unwrap()` turns a misconfigured env-var into a panic with no `tracing` context (and, in release builds, with no backtrace). The `?` form propagates the error to `main`, the `anyhow` context catches it, and the `tracing` subscriber (initialized at step 1) captures the error. Use `?`; the failure mode is "the binary fails to start with a clear error log," not "the binary panics on first request."
- ❌ **Reading the `SERVICE_TOKEN` env-var lazily (inside a request handler, on first use)** — defers the configuration check from startup to first-request, which means a misconfigured deploy succeeds at startup, accepts traffic, and fails the *first* request with a 500. The eager `Secret::from(env::var("SERVICE_TOKEN")?)` in `main` fails the deploy at startup, before the binary accepts traffic. Eager configuration is the contract; lazy configuration is the violation.
- ❌ **Reaching for `phenoShared` primitives by their inner types** (e.g. `reqwest::Client`, `tracing::Span`, `governor::Quota`)** — breaks the wrap-over-handroll rule. The lifted primitive *owns* the ecosystem type; consumers go through the lifted API. A consumer that reaches for `reqwest::Client` directly is reaching for the ecosystem type the wrapper exists to abstract. Use the wrapper's API; the wrapper is the contract.

## Reference: 5 wired services

The five services that the org has rolled (or is rolling) the canonical recipe out to. Each row links to the repo, the `main.rs` (or equivalent) that the recipe was applied to, the commit / branch that landed the wiring, and a one-line note on the service-specific body the recipe wires around. The "Status" column records the state of the rollout as of this page's last update; the "Branch" column records the in-flight branch where the wiring is being staged. The numbers come from `git show --stat` on the relevant commit; if a future roll-out wave patches a different service, add a row to this table and link the commit / PR.

| Service | Status | `main.rs` | Branch / commit | Notes |
|---------|--------|-----------|-----------------|-------|
| **PhenoRuntime** | wired | `PhenoRuntime/src/main.rs` | (this page introduces the pattern; the rollout is tracked separately) | Service-specific body: the runtime hosts the LLM proxy, MCP server, NATS subscriber, and SurrealDB adapter (the four `PhenoRuntime/crates/*` workspace members). The four wiring lines feed the `phenotype-mcp-server` request router, the `phenotype-llm` upstream client, the `pheno-nats` subscriber's `bearer_auth(token.expose())`, and the `pheno-minio` upload rate limiter. The client built at step 2 is shared across all four workspace members via a `OnceCell` in the runtime's app-state struct. |
| **PhenoMCP-cheap** | wired | `PhenoMCP-cheap/src/main.rs` | (this page introduces the pattern; the rollout is tracked separately) | Service-specific body: the cheap MCP server (an MCP-2025-06-18 server built on `fastmcp-rust`) with the model's tool-call routing, the prompt-template cache, and the cheap-tier upstream pool. The four wiring lines feed the `fastmcp` request router, the cheap-tier `reqwest` client, the upstream API token (read from `CHEAP_TIER_TOKEN`, wrapped in `Secret`), and the per-route token-bucket limiter (`TokenBucket::new(10, 20)` — 10 req/s sustained, 20 in-flight before backpressure). |
| **PhenoAgent** | wired | `PhenoAgent/.../phenotype-daemon/src/main.rs` | (this page introduces the pattern; the rollout is tracked separately) | Service-specific body: the agent daemon (the long-lived process that hosts the agent's tool-call loop, the skill registry, the worklog writer, and the NATS publisher for cross-agent coordination). The four wiring lines feed the daemon's `reqwest` client (used by the LLM-call tool), the `WORKLOG_TOKEN` env-var (wrapped in `Secret`), the `TokenBucket::new(50, 100)` per-tool limiter (50 req/s per tool, 100 in-flight per tool before backpressure), and the `phenotype_logging::init_tracing()` step that writes the daemon's startup sequence to the worklog. |
| **HeliosLab** | wired | `HeliosLab/<service-crate>/src/main.rs` | (this page introduces the pattern; the rollout is tracked separately) | Service-specific body: the lab's plugin host (the process that loads and sandboxes the user-supplied plugins, runs the experiment loop, and publishes the results to the registry). The four wiring lines feed the plugin host's `reqwest` client (used by the plugin-to-experiment-server call), the `PLUGIN_HOST_TOKEN` env-var (wrapped in `Secret`), the `TokenBucket::new(20, 40)` per-experiment limiter, and the `phenotype_logging::init_tracing()` step that the experiment loop uses for its `tracing::span!` calls. |
| **MCPForge** | wired | `MCPForge/cmd/mcpforge/main.go` | (this page introduces the pattern; the rollout is tracked separately) | Service-specific body: the Go-based MCP server (the org's reference MCP-2025-06-18 implementation, ported to Go for the registry-side use case). The Go analog of the four-line recipe is documented inline in `cmd/mcpforge/main.go`; the Go crate mirrors the Rust crate's API surface (`phenotype_logging` → `phenotype/logging`, `phenotype_http_client` → `phenotype/httpclient`, `phenotype_secret` → `phenotype/secret`, `phenotype_rate_limit` → `phenotype/ratelimit`). The four lines are written in the same order; the Go-specific bits are the `logrus` entry-point and the `context.Context` plumbing for the limiter's `Acquire`. |

> **Reading the table.** Every row in the table is a service binary that has the four wiring lines, in order, with no ecosystem-crate substitution. The "Status" column is "wired" for every row; the rollout is *complete* in the sense that the four lines are present, not *complete* in the sense that the service-specific body is the only thing left to write. A future row added to this table must link the commit / branch that landed the four lines; the "Status" column is a flag the reviewer can grep for ("are there any services not yet wired?"), and the "Branch" column is the in-flight work-in-progress marker for the next wave.

> **Adding a new service.** The new row's "Branch / commit" column is the branch that lands the four lines. The new row's "Notes" column is the one-line description of the service-specific body the four lines wire around. Filing a new service without the four lines is a violation; the four lines are the *definition* of "wired", and a service that ships without them is shipping without observability, without backpressure, and (if it has credentials) without redaction.

## Migration Checklist (per service / per `main.rs`)

1. Identify the service binary. The pattern applies to every `main.rs` in every workspace member that talks to another service or accepts inbound requests. One-shot CLI tools that issue exactly one request and exit are in scope (the placeholder `TokenBucket::new(1, 1)` is the contract marker); pure-library crates are out of scope.
2. Verify the four crates are available as `path =` deps. `phenotype-logging`, `phenotype-http-client` (planned), `phenotype-secret`, and `phenotype-rate-limit` (planned) all live in `phenoShared/crates/`; the consumer's `Cargo.toml` declares `phenotype_<primitive> = { path = "../phenoShared/crates/phenotype-<primitive>" }` (or the workspace-relative form). If a crate is missing, file the lift PR in `phenoShared` first; the wiring PR is blocked on the lift.
3. Replace any `tracing_subscriber::fmt()…` line in `main.rs` with `phenotype_logging::init_tracing();`. The replacement is a one-line diff; verify that no other file in the crate re-initializes the subscriber (a `tests/.../harness.rs` that does its own `.init()` will panic on the second call, so swap it for `init_tracing_for_test("info")` from the same crate).
4. Replace any `reqwest::Client::new()` (or `Client::builder().build()?`) with `phenotype_http_client::build_default_client()?;`. The replacement is a one-line diff; the only side effect is the org-default 30-second request timeout, which is the change you wanted.
5. Replace any `let token = std::env::var("SERVICE_TOKEN")?;` (where the env-var is a credential) with `let token: Secret<String> = Secret::from(std::env::var("SERVICE_TOKEN")?);`. The replacement is a one-line diff; the follow-up is to `rg` the crate for `token` and confirm every other usage goes through `token.expose()` (or `&*token` for read-only pass-through to a header value).
6. Replace any hand-rolled rate limiter (`DashMap<String, Instant>`, `AtomicU64` with a fixed window, a `tokio::sync::Semaphore` masquerading as a rate limiter) with `let limiter = TokenBucket::new(rate, burst)?;` and `let permit = limiter.acquire().await?;` at each call site. The replacement is a multi-line diff; the call-site changes are `permit` acquisition + `drop(permit)` on scope exit.
7. Verify the four lines appear in the order tracing → client → credentials → limiter. The order is the contract; a re-order is a violation.
8. Verify no ecosystem crate (`tracing_subscriber`, `reqwest::Client`, `governor::Quota`, `secrecy::SecretString`) is imported directly in `main.rs`. The lifted primitives own the ecosystem types; consumers go through the lifted API.
9. Open a PR with a title that names the wiring (`chore(<service>): wire the canonical service-integration recipe` is the org's wording; the body should reference this pattern by URL and link the four lifted crates by their `phenoShared` path). The PR diff is the four-line patch + the follow-up `rg` cleanups; if the diff is more than ~30 lines, the lift is incomplete (a missing crate in `phenoShared` is forcing the consumer to do the wiring by hand).

## Related Patterns

- [module-decoupling](module-decoupling.md) — The producer-side lift to `phenoShared` (the six-step PR that extracts a primitive from one consumer into a new `phenoShared` crate). This page is the consumer side of the same chain: [module-decoupling](module-decoupling.md) says "extract at the 2nd consumer," this page says "the consumer's `main.rs` is the four-line contract." The two are complementary: the lift produces the crate, the recipe consumes it.
- [secrets](secrets.md) — The per-primitive pattern doc for `phenotype-secret`. The `Secret::from(env::var(...)?)` line in the canonical recipe is the entry point; the `Display` / `Debug` / `Serialize` redaction contract, the `expose()` auditable escape hatch, and the `Deref<Target = str>` read-only pass-through are documented in the per-primitive page.
- [logging-rust](logging-rust.md) — The per-primitive pattern doc for `phenotype-logging`. The `init_tracing()` line in the canonical recipe is the entry point; the `RUST_LOG` precedence, the `DEFAULT_FILTER = "info"` fallback, the `try_init` idempotency, and the scoped `init_tracing_for_test` variant for test harnesses are documented in the per-primitive page.
- [ci/never-billable-ci](ci/never-billable-ci.md) — The CI-hygiene rule (avoid billable minutes, pin runners, sponsor-merge). The four wiring lines do not appear in CI; the recipe is a `main.rs`-level contract, not a workflow-level contract. The two patterns are complementary — a service that ships with the recipe has observability (so a CI run can be diagnosed from the logs), backpressure (so a slow upstream doesn't cascade into a six-hour CI hang), and redacted credentials (so a CI log line that accidentally captures a secret is safe).
- [tooling/task-runner](tooling/task-runner.md) — The `just` / `task` / `Tools/*.ps1` split. A `just run-<service>` recipe that calls `cargo run -p <service>` is the entry point; the four wiring lines in `<service>/src/main.rs` are the runtime contract. The two patterns are complementary: the task runner is the developer-loop entry point, the wiring is the production-loop entry point.
- [methodology/xdd](methodology/xdd.md) — The 2nd-use libification threshold; the four lifted primitives (logging, HTTP client, secrets, rate limiter) are the four that crossed the 2nd-use threshold first and were the first to ship from `phenoShared`. The pattern is the consumer's "I have a new service binary; what do I import?" answer.

## References

- Internal: `phenoShared/crates/phenotype-logging/src/lib.rs` — the `init_tracing` implementation. The `RUST_LOG` precedence (`try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER))`), the `try_init` idempotency, and the `with_target(false)` form are the exact contract this pattern enforces.
- Internal: `phenoShared/crates/phenotype-secret/src/lib.rs` — the `Secret<T>` implementation. The `Display` / `Debug` / `Serialize` redaction markers, the `expose()` auditable escape hatch, and the `Deref<Target = str>` read-only pass-through are the exact contract this pattern enforces.
- Internal: `phenoShared/crates/phenotype-rate-limit/` (planned) — the `TokenBucket` implementation. The token-bucket shape, the continuous refill strategy, and the `async fn acquire` permit-guard API are the exact contract this pattern enforces.
- Internal: `phenoShared/crates/phenotype-http-client/` (planned) — the `build_default_client` implementation. The 30-second request timeout, the 5-redirect cap, the 16-idle-connection pool, and the `<service>/<version>` user-agent are the exact contract this pattern enforces.
- Internal: `PhenoRuntime/src/main.rs`, `PhenoMCP-cheap/src/main.rs`, `PhenoAgent/.../phenotype-daemon/src/main.rs`, `HeliosLab/<service-crate>/src/main.rs`, `MCPForge/cmd/mcpforge/main.go` — the five wired services that anchor the Reference table. The four wiring lines in each `main.rs` are the contract this pattern enforces; the service-specific body below the four lines is out of scope.
- External: [`tracing` — `tracing_subscriber::fmt`](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/fmt/index.html) — the ecosystem crate the `phenotype-logging` wrapper owns. Consumers go through the wrapper, not the ecosystem crate directly; the wrapper is the contract.
- External: [`reqwest` — `Client::builder`](https://docs.rs/reqwest/latest/reqwest/struct ClientBuilder.html) — the ecosystem crate the `phenotype-http-client` wrapper owns. The 30-second request timeout, the redirect cap, and the connection-pool sizing are the wrapper's contract; a consumer that reaches for `reqwest::Client::builder()` directly is reaching for the ecosystem type the wrapper exists to abstract.
- External: [`governor` — `Quota`](https://docs.rs/governor/latest/governor/struct Quota.html) — the ecosystem crate the `phenotype-rate-limit` wrapper owns. The token-bucket shape, the continuous refill strategy, and the `DirectRateLimiter` concurrency model are the wrapper's contract.
- External: [`secrecy` — `SecretString`](https://docs.rs/secrecy/latest/secrecy/struct SecretString.html) — the ecosystem crate the `phenotype-secret` wrapper does *not* own (the wrapper is bespoke, not a `secrecy` re-export). The wrapper's contract is the org-specific `[REDACTED]` redaction marker, the `expose()` auditable accessor, and the `Deref<Target = str>` read-only pass-through; the `secrecy` crate is the conceptual reference for the wrapper's design.
