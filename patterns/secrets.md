# Secrets Management Pattern

**Status:** adopted · **Applies to:** every Rust binary, library, and adapter in the Pheno* ecosystem that touches an API key, bearer token, HMAC secret, database password, signing key, or any other value that must not be logged, serialized into a public envelope, or surfaced in a panic message.

## Overview

Every secret that flows through a Phenotype service — outbound API keys, inbound shared secrets, JWT signing keys, DB DSNs, webhook signing secrets — is held in a `phenotype_secret::Secret<T>`, never a bare `String` or `&str`. The `Secret<T>` newtype makes accidental exfiltration a compile error or a `Debug`-format no-op, depending on the surface:

- Its `Debug` impl prints `Secret(<redacted>)`, so a `tracing::error!(?api_key)` or a `panic!("missing {api_key}")` cannot leak the value into a log line, a Sentry breadcrumb, or a `tracing-subscriber` JSON envelope.
- Its `Display` impl is the same redaction shape, so `format!("{}", api_key)` and `writeln!(buf, "{}", api_key)` cannot accidentally render the cleartext.
- Its `Serialize` impl (when the `serde` feature is enabled) emits the redacted form, so a `tracing-subscriber` JSON layer, an `/errors` envelope, or a `serde_json::to_string` round-trip never carries the cleartext to disk or to a downstream service.
- Its `Deref<Target = T>` impl preserves ergonomic access at the use site (`build_client(secret.bearer())` reads like a normal function call) without giving `String`/`&str` operations free rein.

The previous convention — `let api_key: String = env::var("API_KEY")?;` followed by ad-hoc `{:?}` masks, custom `redact()` helper functions, and `tracing` `field`s lists hand-picked to skip the key — drifted, and the drift was invisible. A `Debug` impl on `String` cannot tell you it leaked; a `Secret<String>` can. This page is the canonical place that rule lives.

## The Rule

| Context | Use | Crate / Symbol | Why |
|---------|-----|----------------|-----|
| A Rust function receives or holds an API key, bearer token, HMAC secret, DB password, or signing key | `phenotype_secret::Secret<String>` (or `Secret<&'static str>` for compile-time literals) | `phenotype-secret` (`phenotype-secret/src/lib.rs`) | The newtype's `Debug` / `Display` / `Serialize` impls are redacted. A naked `String` is not. |
| A constructor or builder wants a typed secret without the `Secret` wrapper | `Secret::new(value)` at the boundary; expose `&Secret<T>` to the rest of the code | `phenotype-secret` (`phenotype-secret/src/secret.rs`) | Keep the `Secret` boundary at the IO/parse step so the rest of the binary inherits the redaction. |
| A function needs to read the cleartext to pass it to a downstream SDK that does not accept `Secret<T>` | `secret.expose()` / `secret.as_str()` (whichever the crate exposes) **at exactly one call site**, with a comment naming the API that requires the cleartext | `phenotype-secret` | One explicit, auditable exposure beats an untyped `String` that the type system cannot see. |
| A config struct deserialized from `.env`, YAML, or `figment` should hold a secret field | `#[serde(with = "phenotype_secret::serde::redact")] String` *or* `phenotype_secret::Secret<String>` directly, depending on whether the deserializer is aware of newtypes | `phenotype-secret` | The `with` adapter keeps the field name in the parsed struct without forcing the rest of the codebase to learn about the newtype. |
| A test needs to assert "this secret was redacted in the log output" | Construct a `Secret<String>` and assert on its `Debug` / `Display` / `Serialize` output | `phenotype-secret` | The redaction is testable; a hand-rolled `redact()` helper is not. |

**Hard rule:** `let api_key: String = env::var("API_KEY")?;` (and the `&str` / `Cow<str>` / `Vec<u8>` variants) is **forbidden** in Phenotype code for any value that is a credential. The `String` type cannot tell a log line from a header from a panic message from a `serde_json::to_string` round-trip; the `Secret<T>` type can. If a downstream API forces a `&str` (e.g. `reqwest::header::HeaderValue::from_str`), call `.expose()` at exactly that one call site — do not unwind the newtype earlier than the boundary that requires it.

## Canonical Pattern

### Add the dependency

```toml
# crates/<name>/Cargo.toml
[dependencies]
phenotype-secret = { path = "../phenotype-secret" }

# Do NOT add a hand-rolled `pub struct ApiKey(String)` with a custom
# `Debug` impl that prints `"<redacted>"`, and do NOT add a local
# `redact(&str) -> String` helper. Both silently drift the next time
# someone adds a second secret field, and neither participates in
# `tracing-subscriber`'s JSON envelope. Depend on `phenotype-secret`
# and reach for `Secret<T>`.
#
# `phenotype-secret` has no transitive dependencies, so the cost of
# pulling it in is a single `path =` line and the `Secret` newtype.
```

### Load a secret from the environment

```rust
// crates/<name>/src/config.rs
use std::env;
use phenotype_secret::Secret;

/// Configuration for the upstream API client.
///
/// `api_key` is `Secret<String>` rather than `String` because every
/// field on this struct is reachable from `tracing`, `Debug`, and
/// (under the `serde` feature) `serde_json::to_string` — keeping
/// the credential inside the newtype is the only way to make
/// accidental exfiltration a no-op at every one of those surfaces.
pub struct UpstreamConfig {
    pub base_url: String,
    pub api_key: Secret<String>,
}

impl UpstreamConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        // The `Secret` boundary is here, at the IO/parse step.
        // Everything downstream of this function sees a typed
        // secret, not a raw `String`.
        let api_key = Secret::new(
            env::var("PHENO_API_KEY")
                .map_err(|_| ConfigError::Missing("PHENO_API_KEY"))?,
        );
        Ok(Self {
            base_url: env::var("PHENO_BASE_URL")
                .unwrap_or_else(|_| "https://api.example.com".to_string()),
            api_key,
        })
    }
}
```

### Use the secret in a client without leaking it

```rust
// crates/<name>/src/client.rs
use phenotype_secret::Secret;
use reqwest::header::{HeaderValue, AUTHORIZATION};

pub struct UpstreamClient {
    base_url: String,
    api_key: Secret<String>,
    http: reqwest::Client,
}

impl UpstreamClient {
    pub fn new(base_url: String, api_key: Secret<String>) -> Self {
        Self { base_url, api_key, http: reqwest::Client::new() }
    }

    pub async fn fetch(&self, path: &str) -> Result<reqwest::Response, ClientError> {
        // One explicit exposure. The comment names the API that
        // requires the cleartext so the next reviewer does not
        // refactor it away.
        //
        // `reqwest::header::HeaderValue::from_str` needs `&str`,
        // and the `Authorization` header is the one place the
        // cleartext is allowed to leave the process boundary.
        let bearer = format!("Bearer {}", self.api_key.expose());

        let response = self
            .http
            .get(format!("{}{}", self.base_url, path))
            .header(AUTHORIZATION, HeaderValue::from_str(&bearer)?)
            .send()
            .await?;
        Ok(response)
    }
}
```

### Verify the secret was redacted in a log line

```rust
// crates/<name>/src/observability.rs
use phenotype_secret::Secret;
use tracing::error;

pub fn report_failure(client: &UpstreamClient, err: &(dyn std::error::Error + 'static)) {
    // `?client.api_key` would print the cleartext; `client.api_key`
    // invokes the `Debug` impl, which prints `Secret(<redacted>)`.
    // The two forms look almost identical at the call site; the
    // type system is the only thing that distinguishes them.
    error!(
        base_url = %client.base_url,
        api_key = ?client.api_key,
        error = %err,
        "upstream fetch failed",
    );
}
```

```rust
// crates/<name>/tests/secrets_redacted.rs
use phenotype_secret::Secret;
use tracing_subscriber::fmt::format::FmtSpan;

#[test]
fn debug_impl_redacts_cleartext() {
    let api_key = Secret::new("sk-1234567890abcdef".to_string());
    let rendered = format!("{:?}", api_key);
    assert_eq!(rendered, "Secret(<redacted>)");
    // Belt-and-braces: the cleartext must not appear anywhere in
    // the rendered form, even if the redacted marker changes.
    assert!(!rendered.contains("sk-1234567890abcdef"));
}

#[test]
fn display_impl_redacts_cleartext() {
    let api_key = Secret::new("sk-1234567890abcdef".to_string());
    assert_eq!(format!("{}", api_key), "Secret(<redacted>)");
    assert!(format!("{}", api_key).contains("redacted"));
}
```

Conventions (lifted from `phenoShared/crates/phenotype-secret/src/secret.rs:1-200`):

- `Secret<T>` wraps a single `T` field and exposes `Deref<Target = T>`. The `expose()` / `as_str()` method is the only sanctioned way to read the cleartext, and it should be called at exactly one site per secret per process — the boundary that hands the credential to the downstream API.
- `Secret<T>`'s `Debug` / `Display` impls render the literal string `"Secret(<redacted>)"`. If a log line or a panic message needs more context (a key prefix, a fingerprint), compute it from a non-secret field (`api_key.id`, `api_key.prefix`) and never from the cleartext.
- The `Serialize` impl (under the `serde` feature) emits the same redacted form. A `tracing-subscriber` JSON layer, a `serde_json::to_string(&config)`, and a `tracing` event with a `Secret<String>` field all converge on one shape.
- `Secret<T>` is `Send + Sync` whenever `T: Send + Sync`. It is not `Clone` by default — credentials are not values you copy around. If a function needs to share a secret across tasks, pass `Arc<Secret<T>>` and reach for `Arc::clone`.
- The boundary between raw IO (`env::var`, `figment`, `serde_yaml`) and `Secret<T>` lives at the config-parsing step. Past that step, no function takes `String` for a credential; the type system enforces the redaction.

## Anti-Patterns

- ❌ `let api_key: String = env::var("API_KEY")?;` — the `String` type has no concept of "this is a credential." Every `Debug` / `Display` / `Serialize` surface that touches it leaks the cleartext. Use `Secret::new(env::var("API_KEY")?)` and let the newtype carry the redaction contract.
- ❌ `let api_key: &str = env::var("API_KEY")?;` — same problem with a different lifetime. The `&str` is one step closer to the cleartext; the redaction contract lives in your head, not in the type. `Secret<&'static str>` is the literal-only variant; `Secret<String>` is the runtime variant.
- ❌ Hand-rolled `pub struct ApiKey(pub String);` with a custom `Debug` impl that prints `"<redacted>"` — re-implements the redaction at every call site, drifts the day someone adds a `Clone` impl or a `Display` impl, and is invisible to `tracing-subscriber`'s JSON envelope. Depend on `phenotype-secret` and use its `Secret<T>`.
- ❌ `redact(&str) -> String` helper that returns `"****"` — converts a credential into a string the rest of the code cannot tell apart from any other string, and the helper is not a type, so the compiler cannot enforce its use. `Secret<T>` *is* a type; the compiler can enforce it.
- ❌ `tracing::error!("failed: {api_key}")` or `tracing::error!(?api_key)` against a raw `String` — both render the cleartext into the log line. Use `tracing::error!(?secret)` against a `Secret<T>`; the redaction is the `Debug` impl.
- ❌ `panic!("missing api key {}", api_key)` — a panic message is a log line. The cleartext is now in `stderr`, in `journald`, in a Sentry breadcrumb, and in a `tracing` event. Panic on the missing-env-var condition; do not include the credential in the message.
- ❌ `serde::Serialize` on a config struct that holds a `String` API key — a `tracing-subscriber` JSON layer, an `anyhow::Error::context` chain, or a `serde_json::to_string(&config)` round-trip exfiltrates the cleartext. Either change the field to `Secret<String>` or annotate it with `#[serde(serialize_with = "phenotype_secret::serde::redact::serialize")]`.
- ❌ `let api_key: String = std::fs::read_to_string("/run/secrets/api_key")?;` then threading the `String` through the codebase — same type problem as `env::var`, with a longer-lived secret on disk. Wrap with `Secret::new(...)` at the IO step and never unwind before the boundary.
- ❌ `tracing::instrument` on a function that takes `&str` and logs the value as a structured field — the field renders into the span's `Debug` output, and a `tracing-subscriber` JSON layer will write the cleartext to the log stream. Take `&Secret<String>` and rely on the `Debug` impl.
- ❌ `let mut api_key: String = ...; api_key.push_str(&more);` — building a credential by mutation loses the audit trail (the cleartext was constructed in pieces; the pieces are not logged; the assembled string is). Construct the credential in one expression inside a `Secret::new(...)` call.
- ❌ `format!("Authorization: Bearer {api_key}")` stored in a `String` reused across requests — every call site that holds the `String` can leak it. The `Secret<String>` should be the only handle on the cleartext; the `format!` happens inside the request-builder method that calls `.expose()`.
- ❌ Re-exporting `phenotype_secret::Secret` from a consuming crate under a different name (`pub use phenotype_secret::Secret as Credential;`) and pretending the rename is "stricter" — the rename is a documentation tool, not a type-system change. The redaction contract lives in `phenotype-secret`, not in the local alias. Use the upstream name unless the local alias is documented in this page.
- ❌ `unwrap()`-on-the-cleartext patterns that use the secret value as an error message (`api_key.unwrap_or_else(|_| "missing".into())`) — once the `env::var` is wrapped in a `Secret`, this shape is no longer needed. The `Secret::new(env::var(...)?)` form fails on `Err(VarError::NotPresent)` before the cleartext is ever read.

## Reference Implementation

The single source of truth for the `Secret<T>` newtype:

| Repo | Path | Symbol | Notes |
|------|------|--------|-------|
| **phenoShared** | `crates/phenotype-secret/src/lib.rs` | `pub struct Secret<T> { inner: T }` | The newtype. Holds a single `T` field; does not derive `Clone`. |
| **phenoShared** | `crates/phenotype-secret/src/secret.rs:1-40` | `impl<T> Secret<T>` (`new`, `expose`, `as_ref`, `deref`) | The constructors and accessors. `expose` / `as_str` is the only sanctioned cleartext escape hatch. |
| **phenoShared** | `crates/phenotype-secret/src/secret.rs:42-60` | `impl<T: Debug> Debug for Secret<T>` | Renders the literal `"Secret(<redacted>)"`. This is the contract the rest of the codebase relies on. |
| **phenoShared** | `crates/phenotype-secret/src/secret.rs:62-70` | `impl<T: Display> Display for Secret<T>` | Same redacted form, so `format!("{}", secret)` and `writeln!` cannot leak. |
| **phenoShared** | `crates/phenotype-secret/src/secret.rs:72-100` | `impl<T> Deref for Secret<T>` (target = `T`) | Ergonomic access at the use site without exposing the cleartext to `String` operations. |
| **phenoShared** | `crates/phenotype-secret/src/serde.rs` (feature-gated) | `pub mod redact { pub fn serialize<S: Serializer>(...) }` | Adapter for `#[serde(serialize_with = "...")]` on raw `String` fields. Use this when the rest of a struct cannot move to `Secret<T>`. |
| **phenoShared** | `crates/phenotype-secret/src/lib.rs:re-exports` | `pub use secret::Secret;` | The re-exports that make the crate usable as `phenotype_secret::Secret` (no `secret::` prefix). |
| **phenoShared** | `crates/phenotype-secret/src/secret.rs::tests` | `mod tests` | Inline tests asserting the redaction shape on `Debug`, `Display`, and `Serialize`. If a test changes the redaction string, update this page. |

## Migration Checklist (per binary / library)

1. Add `phenotype-secret = { path = "../phenotype-secret" }` to `[dependencies]`.
2. Replace every `let api_key: String = env::var("...")?;` (and the `&str` / `Cow<str>` / `Vec<u8>` / `Bytes` / `SecretBytes` variants) with `let api_key: Secret<String> = Secret::new(env::var("...")?);`. The boundary moves from "the env var" to "the `Secret::new` call."
3. Replace every `let token: String = read_from_disk(...)?;` with `let token: Secret<String> = Secret::new(read_from_disk(...)?);`. The on-disk format does not change; only the in-memory wrapper does.
4. Replace every `pub api_key: String` field on a config struct with `pub api_key: Secret<String>` — or, if the rest of the struct is intentionally a `String` shape, annotate with `#[serde(serialize_with = "phenotype_secret::serde::redact::serialize")]` and add a `#[derive(Serialize)]`-level test that asserts the cleartext never reaches the serialized form.
5. Replace every `format!("Bearer {}", api_key)` outside the request builder with `let bearer = format!("Bearer {}", api_key.expose());` inside the builder. Add a comment naming the API that requires the cleartext so the next reviewer does not refactor the boundary upward.
6. Replace every `tracing::error!("...{api_key}...")` and `tracing::error!(?api_key)` against a raw `String` with the same call shape against a `Secret<String>`. The `Debug` impl does the redaction.
7. Delete every `redact(&str) -> String` helper, every `mask_token` constant, and every hand-rolled `ApiKey(pub String)` newtype. The type system is the helper now.
8. Replace every `panic!("missing {api_key}")` with `panic!("missing PHENO_API_KEY")` (or the equivalent `Result::expect("missing PHENO_API_KEY", env::var(...))` shape). The panic message should name the variable, not the value.
9. Add a test in `crates/<name>/tests/secrets_redacted.rs` that constructs a `Secret<String>`, formats it via `Debug` and `Display`, and asserts the cleartext is absent. This pins the redaction contract at the consumer's test boundary.
10. If the binary ships a `--print-config` or `dump-config` debug command, confirm the output does not include the credential field. If it does, replace the field's `Debug` / `Display` / `Serialize` shape with the `Secret<T>` form.

## Related Patterns

- [build-info](build-info.md) — sibling "canonical primitive" pattern: one crate owns a cross-cutting concern, every consumer reaches for the same symbol. The same shape (one crate, one newtype, one contract) is what makes `phenotype-secret` work.
- [config-loading](config-loading.md) — sibling "canonical primitive" pattern: timeouts and typed errors live in one crate, called from every consumer. The `Secret<T>` boundary is the *credential* analogue of the typed-error boundary.
- [methodology/wrap-over-handroll](methodology/wrap-over-handroll.md) — `phenotype-secret` is the org's wrapper around `String` / `&str` for the credential subset. Hand-rolled `redact()` helpers, custom `ApiKey` newtypes, and `format!("****")` masks are the hand-rolled equivalents we are wrapping.
- [architecture/hexagonal](hexagonal.md) — `Secret<T>` is a *port*: the type the rest of the binary depends on, the `env::var` / `read_to_string` / `figment` adapter that populates it. The boundary lives at the IO/parse step so the redaction contract is enforced inside the application.
- [stack/defaults](stack/defaults.md) — the `.env`-only config rule is the *outer* contract (no secrets in the repo); `Secret<T>` is the *inner* contract (no secrets in log lines, panic messages, or `serde_json` envelopes). The two rules are complementary, not redundant.
- [ci/never-billable-ci](ci/never-billable-ci.md) — TruffleHog secret scanning is the *outer* defense (catch a leaked secret before it merges); `Secret<T>` is the *inner* defense (do not give the value a type that can leak it). The two defenses target different points in the lifecycle.

## References

- [`Secret<T>` newtype pattern](https://docs.rs/secrecy/latest/secrecy/struct.Secret.html) — the upstream Rust crate (`secrecy::Secret`) that the `phenotype-secret` newtype is modelled on. Read this if you need a deeper treatment of the `Debug`/`Display`/`Serialize` contracts and the `expose()` boundary.
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — the threat model that justifies the newtype: credentials in log files, error reports, stack traces, and serialization envelopes are the dominant leak vector in modern Rust services.
- [TruffleHog](https://github.com/trufflesecurity/trufflehog) — the git-history secret scanner that catches leaked credentials *before* the `Secret<T>` newtype can save them. The two tools are complementary.
- [ADR-008 — Security Architecture](https://github.com/KooshaPari/PhenoHandbook/blob/main/adrs/008-security.md) — the org-level security baseline. `Secret<T>` is the in-process complement to the TruffleHog + `cargo-deny` + Dependabot triad.
- [stack/defaults](stack/defaults.md) — the `.env`-only config rule, restated for completeness. A `Secret<T>`-typed field in a config struct does not change the `.env` shape; it changes the in-memory type.
- Internal: `phenoShared/crates/phenotype-secret/src/secret.rs` — the newtype this page governs. If you change the redaction string, add a new accessor, or change the `Serialize` shape, update this page in the same PR.
- Internal: `phenoShared/crates/phenotype-secret/src/serde.rs` — the `serde` adapter. If you add a new deserializer (`serde::Deserialize` for `Secret<T>`), update this page in the same PR.
