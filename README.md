# PhenoHandbook - Patterns & Guidelines Registry

**Living documentation for design patterns, anti-patterns, guidelines, and best practices in the Phenotype ecosystem.**

This repository serves as the **central knowledge base** for how to build software the "Phenotype way."

---

## Quick Start

```bash
# Browse patterns by domain
ls patterns/auth/                 # Auth patterns
ls patterns/caching/              # Caching patterns

# Read specific pattern
cat patterns/auth/oauth-pkce.md

# Check anti-patterns (what NOT to do)
cat anti-patterns/security/plaintext-tokens.md

# Follow a methodology
cat methodologies/tdd-workflow.md

# Use a checklist
cat checklists/deployment.md
```

---

## Registry Structure

| Directory | Purpose | Contents |
|-----------|---------|----------|
| `patterns/` | Design patterns by domain | Async, caching, auth, observability, etc. |
| `anti-patterns/` | What NOT to do | Common mistakes and their fixes |
| `guidelines/` | Coding standards | Style guides, review criteria, conventions |
| `methodologies/` | Development workflows | TDD, BDD, DDD, xDD patterns |
| `checklists/` | Verification lists | Pre-deployment, security, testing |
| `mkdocs.yml` | Site config | For published documentation site |

---

## Pattern Format

Each pattern follows this structure:

```markdown
# Pattern Name

## Summary
One-sentence description.

## Problem
What problem does this solve?

## Solution
How to implement it.

## Example
```rust
// Good example
```

## When to Use
- When X happens
- When Y is needed

## When NOT to Use
- When Z applies

## Related Patterns
- [Related Pattern](./related.md)
- SPEC-AUTH-001 (links to spec)

## References
- Links to ADRs
- External resources
```

---

## Connection to Specs & Templates

Patterns in this handbook inform:

1. **Specs** in [PhenoSpecs](https://github.com/KooshaPari/PhenoSpecs) - Patterns become specs
2. **Templates** in [HexaKit](https://github.com/KooshaPari/HexaKit) - Patterns inform template structure
3. **Code** in all repos - Patterns guide implementation

---

## xDD Methodologies

From [xDD_METHODOLOGIES.md](https://github.com/KooshaPari/xDD_METHODOLOGIES.md):

| Methodology | When to Use |
|-------------|-------------|
| TDD | Unit-level logic |
| BDD | Feature scenarios |
| DDD | Complex domains |
| SDD | Spec-first projects |
| FDD | Feature-centric work |
| CDD | API contracts |
| AI-DD | AI-assisted coding |

See `methodologies/` for detailed workflows.

---

## Living Documentation

This handbook is published as a documentation site:

```bash
# Local preview
mkdocs serve

# Build
mkdocs build

# Deploy
git push origin main  # Auto-deploy via CI
```

---

## Contributing

1. **New pattern**: Create PR with pattern in appropriate domain folder
2. **Update pattern**: Edit + add changelog entry
3. **Anti-pattern**: Explain the problem + the fix
4. **Guideline**: Include rationale and examples

All contributions must link to relevant specs in PhenoSpecs.

---

## Links

- [PhenoSpecs](https://github.com/KooshaPari/PhenoSpecs) - Specifications
- [HexaKit](https://github.com/KooshaPari/HexaKit) - Templates
- [AgilePlus](https://github.com/KooshaPari/AgilePlus) - Spec-driven development
