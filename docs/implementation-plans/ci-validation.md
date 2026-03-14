# CI Validation Implementation Plan

This plan covers the work needed to add repeatable quality-control gates to Emoji Nook so changes are validated before merge and before release. It is informed by existing patterns already in use across `liminal-hq` and related repositories.

## Goal

Establish a practical CI baseline for Emoji Nook that checks formatting, linting, type safety, builds, and tests across the frontend, Tauri backend, and local plugin workspace, while keeping the workflow easy to understand and maintain.

## Current State Review

Emoji Nook is still early in its tooling maturity:

- There is no checked-in `.github/workflows/` directory
- Root scripts cover development and builds, but not dedicated lint, format, or test gates
- The frontend app currently has `build`, but no explicit `test`, `typecheck`, or `lint` scripts
- There is no checked-in formatter, linter, or test-runner configuration
- The Rust workspace builds locally, but there is no CI enforcement for `cargo fmt`, `cargo clippy`, or `cargo test`
- There is no required branch-protection or merge-gate policy documented yet

## Related Repository Review

Several repositories in and around `liminal-hq` already provide useful precedents.

### `liminal-hq/threshold`

- Uses a multi-job `test.yml` workflow with separate JS, Rust, Kotlin, and diagram validation jobs
- Uploads test artefacts and publishes JUnit reports
- Uses `cargo nextest` for Rust tests
- Uses Prettier for formatting in the repo
- Includes workflow summaries and report aggregation
- Has an open issue to standardise a `cargo test` baseline with `nextest` as an opt-in where it is measurably beneficial

This is the strongest precedent for a broad, split-by-concern CI validation workflow.

### `ScottMorris/liminal-notes`

- Uses a focused `test-ci.yml` workflow with package tests, desktop lint/typecheck, Rust tests, and desktop UI tests
- Runs Tauri-related jobs inside prebuilt GHCR CI containers
- Structures many commands as root-level `ci:*` scripts
- Publishes JUnit and coverage artefacts
- Has an open issue to evaluate `cargo-nextest` with a documented `cargo test` fallback policy

This is the closest precedent for a Tauri app with layered desktop validation.

### `liminal-hq/smdu`

- Uses straightforward separate jobs for build, binary build, lint, format, and test
- Keeps each job small and easy to understand
- Writes a short `GITHUB_STEP_SUMMARY` block for every job

This is a good precedent for keeping workflows approachable while still enforcing multiple gate types.

### `liminal-hq/flow`

- Shows a preference for lightweight automation and clear workflow summaries
- Uses release summaries that are concise and operationally useful

This is a helpful precedent for CI presentation style, even though its test surface is smaller.

### `liminal-hq/.github`

- Publishes shared GHCR CI images for Tauri desktop and mobile workflows

This means Emoji Nook should align with the existing shared Docker image strategy where it makes builds more stable.

## Scope

### In scope

- Local scripts for formatting, linting, typechecking, testing, and builds
- GitHub Actions workflows for pull requests and `main`
- Rust and TypeScript validation checks
- Frontend component and hook test coverage
- Workflow summaries and test artefact publication
- Branch-protection-ready status checks

### Out of scope

- Full end-to-end desktop automation against real Wayland or X11 compositors
- Visual regression tooling
- Performance benchmarking infrastructure
- Security scanning beyond basic dependency/build hygiene

## Validation Model

Emoji Nook should adopt layered gates, from fastest feedback to most expensive:

1. Format checks
2. Type and static analysis
3. Unit and component tests
4. Production builds
5. Release-only packaging checks

Recommendation: make the first CI milestone small but complete. A narrow reliable validation baseline is better than an ambitious flaky one.

## Tooling Direction

### Frontend

Recommended baseline:

- Prettier for formatting
- ESLint for linting
- TypeScript `tsc --noEmit` for typechecking
- Vitest for frontend tests
- Testing Library for React component and keyboard-interaction tests

Recommendation: add ESLint in the initial tooling pass alongside Prettier so Emoji Nook aligns with cross-org practice from the start.

### Rust

Recommended baseline:

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace --locked`

Recommendation: align with the direction already being discussed in `threshold` and `liminal-notes`: use `cargo test` as the documented baseline, keep the runner policy explicit, and adopt `cargo nextest` only where it demonstrates measurable reliability or speed wins.

## Implementation Phases

### Gate 1: Local validation commands exist (Phases 1–2)

Create the commands that CI will eventually run.

#### Phase 1: Root script surface

- [ ] Add root scripts for:
  - `format`
  - `format:check`
  - `typecheck`
  - `test`
  - `test:rust`
  - `build`
  - `build:rust`
  - `ci`
- [ ] Prefer root-level orchestration commands so developers and CI use the same entry points
- [ ] Add app-level scripts in `apps/emoji-picker/package.json` for:
  - `typecheck`
  - `test`
  - `test:ci`
  - `lint`
- [ ] Keep script names aligned with the patterns seen in `liminal-notes` and `smdu`

#### Phase 2: Base tooling

- [ ] Add Prettier configuration for Markdown, JSON, TypeScript, and other authored text files
- [ ] Add Vitest configuration for `apps/emoji-picker`
- [ ] Add Testing Library support for React component tests
- [ ] Add ESLint configuration in the first pass so linting ships alongside formatting and typechecking
- [ ] Add Rust formatting and clippy commands to the documented local workflow

**Gate 1 result: developers can run the full local validation suite with stable, documented commands.**

### Gate 2: Core tests and static checks exist (Phases 3–4)

Add enough tests and static analysis for CI to enforce something meaningful.

#### Phase 3: Frontend validation baseline

- [ ] Add frontend tests for:
  - Search behaviour
  - Category navigation
  - Keyboard navigation
  - Selection preview behaviour
  - Theme hook behaviour where practical
- [ ] Add a dedicated frontend typecheck command using `tsc --noEmit`
- [ ] Ensure test output can be emitted as JUnit for CI consumption
- [ ] If linting is enabled, ensure it covers React and TypeScript files without producing noisy low-value failures

#### Phase 4: Rust validation baseline

- [ ] Add `cargo test --workspace --locked` coverage for the app backend and plugin workspace
- [ ] Add `cargo fmt --check`
- [ ] Add `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] Document Rust test runner policy explicitly:
  - `cargo test` is the baseline
  - `cargo nextest` is allowed when justified by measured value
  - fallback behaviour is documented
- [ ] Confirm plugin permission generation and build-time metadata do not make CI flaky

**Gate 2 result: the repository has meaningful frontend and Rust validation checks that are suitable for CI enforcement.**

### Gate 3: CI workflow enforces merge gates (Phases 5–6)

Add GitHub Actions jobs that mirror the local commands.

#### Phase 5: CI workflow structure

- [ ] Add `.github/workflows/ci.yml`
- [ ] Trigger on:
  - pull requests targeting `main`
  - pushes to `main`
  - optional manual dispatch
- [ ] Prefer separate jobs for:
  - format
  - frontend typecheck
  - frontend tests
  - Rust format and clippy
  - Rust tests
  - production build
- [ ] Use the shared GHCR CI image pattern from `liminal-hq/.github` where it improves consistency for Tauri and Rust jobs
- [ ] Keep the first workflow intentionally modest; avoid too many matrix combinations until the basics are stable
- [ ] Structure the workflow so fast checks fail early and heavy checks start in parallel:
  - formatting and typecheck should return quickly
  - tests should start without waiting on production packaging
  - Tauri production builds should be isolated in their own job
- [ ] Consider a two-tier model if CI time becomes painful:
  - fast required pull-request checks for format, typecheck, and tests
  - slower required or near-required build validation for packaging confidence
- [ ] Use path filters carefully for expensive jobs, but only where skipped builds cannot hide integration regressions

#### Phase 6: Workflow summaries and artefacts

- [ ] Add a `GITHUB_STEP_SUMMARY` section to every job
- [ ] Design summaries to fit Emoji Nook specifically:
  - `Emoji Nook Format Summary`
  - `Emoji Nook Frontend Test Summary`
  - `Emoji Nook Rust Check Summary`
  - `Emoji Nook Build Summary`
- [ ] Include in summaries:
  - job purpose
  - runner or container used
  - key command results
  - artefacts or reports produced
  - workflow run link when useful
- [ ] Upload JUnit or equivalent test artefacts from frontend and Rust jobs where available
- [ ] Publish test reports in the Actions UI when practical

**Gate 3 result: pull requests receive clear, per-concern status checks with useful job summaries.**

### Gate 4: Branch protection and build confidence (Phases 7–8)

Turn CI from informational to merge-governing.

#### Phase 7: Required checks

- [ ] Decide the required merge gates for `main`
- [ ] Recommended first required checks:
  - format
  - frontend typecheck
  - frontend tests
  - Rust checks
  - production build
- [ ] Document which checks are blocking versus informational
- [ ] Add maintainers’ guidance for handling flaky failures and reruns

#### Phase 8: Build realism

- [ ] Add a Tauri production build gate that validates the app still packages in CI
- [ ] Confirm the plugin workspace builds as part of normal app validation
- [ ] Consider a smoke test layer once desktop integration is further along:
  - app launches
  - key UI renders
  - no immediate startup crash
- [ ] Reuse release-oriented packaging knowledge from the release plan without making every PR run full release packaging

**Gate 4 result: Emoji Nook has practical branch-protection-ready validation checks with build validation.**

## Recommended Command Shape

A likely end state for root commands:

- `pnpm format`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:rust`
- `pnpm build`
- `pnpm build:rust`
- `pnpm ci`

Recommendation: `pnpm ci` should be the closest local mirror of the default CI workflow, even if the GitHub workflow still splits jobs for visibility.

## Risks and Mitigations

### Tooling rollout churn

Adding formatter, linter, typechecker, test runner, and packaging validation all at once is not inherently a problem here; it can be the fastest path to cross-org alignment for a greenfield app. The risk is rollout churn from introducing too many moving parts without a clear order. Mitigate by adopting the full target toolset deliberately, with a documented sequence and stable root scripts from the start.

### Flaky desktop-adjacent tests

Tauri and Linux UI integration can become brittle in CI, especially before window lifecycle work is complete. Mitigate by keeping early tests focused on pure frontend and Rust logic, with desktop smoke tests added later.

### Slow CI feedback

Heavy Tauri builds and Rust compilation can slow pull-request feedback. Mitigate with separate jobs, shared GHCR CI images, aggressive caching, and a staged gate model so fast failures surface early. If needed, keep the slow packaging build isolated from the fastest checks, but still visible and enforceable where it protects release quality.

### Inconsistent workflow summaries

The organisation clearly values job summaries. Mitigate drift by making summaries part of the CI definition of done and by standardising a small Emoji Nook summary structure across jobs.

## Definition of Done

This plan is complete when:

- Developers can run consistent local quality commands from the repo root
- Pull requests run automated format, typecheck, test, and build checks
- Every CI job writes an Emoji Nook-specific workflow summary
- Frontend and Rust test results are available in the Actions UI or as artefacts
- `main` can be protected with the agreed required checks
