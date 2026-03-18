# CI and Release Automation for a Tauri v2 Desktop App

**TL;DR** — Emoji Nook ships with a seven-job CI pipeline, a version-drift guard across six manifests, a one-command release preparation script, and a dual-architecture Linux release workflow that builds AppImage, `.deb`, and `.rpm` bundles for both x64 and arm64. This post walks through how it all fits together.

---

## Context: A Monorepo With Two Ecosystems

Emoji Nook is a [Tauri v2](https://v2.tauri.app/) desktop app with a React 19 frontend and a Rust backend. The project lives in a monorepo managed by pnpm workspaces on the JavaScript side and a Cargo workspace on the Rust side. The emoji picker app sits under `apps/emoji-picker/`, and a custom xdg-portal plugin lives under `plugins/xdg-portal/`.

This dual-ecosystem structure means CI needs to validate two separate toolchains: TypeScript with Prettier, ESLint, and Vitest on one side, and Rust with `cargo fmt`, `cargo clippy`, and `cargo nextest` on the other. On top of that, version metadata is scattered across six different manifest files that must stay in sync for every release.

The goals were straightforward:

- Fast feedback on pull requests
- Meaningful checks that catch real problems
- A release path that is repeatable and hard to get wrong
- Workflow summaries that let maintainers scan outcomes without digging through raw logs

## The CI Pipeline

The CI workflow (`.github/workflows/ci.yml`) runs on pull requests targeting `main`, pushes to `main`, and manual dispatch. It uses concurrency groups keyed by ref so redundant runs cancel automatically:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

Seven jobs run in parallel, split by concern. The lightweight jobs — format, lint, typecheck, and release metadata — need only Node.js and pnpm. The heavier Rust jobs need system libraries for WebKitGTK compilation and run inside a prebuilt container image from the organisation's shared GHCR registry.

### The Frontend Jobs

**Format** checks both Prettier (repository-wide) and `cargo fmt` (Rust workspace) in a single job. This catches style drift early without installing any system dependencies beyond Node.js and Rust:

```yaml
- name: Check repository formatting
  run: pnpm format:check

- name: Check Rust formatting
  run: pnpm format:rust:check
```

**Lint** runs ESLint across the frontend app:

```yaml
- name: Run frontend lint
  run: pnpm lint
```

**Typecheck** runs the TypeScript compiler in check-only mode. No emit, just type validation:

```yaml
- name: Run frontend typecheck
  run: pnpm typecheck
```

This maps to `tsc --noEmit` inside the `apps/emoji-picker` package.

**Frontend tests** runs Vitest with JUnit output, uploads the results as an artefact, and publishes them through two reporting actions so test outcomes show up directly in the pull request UI:

```yaml
- name: Run frontend tests with JUnit output
  run: pnpm --filter @emoji-picker/emoji-picker test:ci

- name: Upload frontend test artefacts
  uses: actions/upload-artifact@v7
  with:
    name: frontend-test-results
    path: test-results/emoji-picker/junit.xml
    if-no-files-found: error
```

### The Rust Jobs

Rust compilation for a Tauri app requires system libraries — `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and friends. Rather than installing these on every run, both Rust jobs use a prebuilt container image:

```yaml
rust-checks:
  name: Rust checks
  runs-on: ubuntu-24.04
  container:
    image: ghcr.io/liminal-hq/tauri-ci-desktop:latest
    credentials:
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}
```

**Rust checks** runs `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`. Clippy runs with `-D warnings` so any warning is a hard failure — no silent degradation.

**Rust tests** uses `cargo nextest` for the test runner, which provides structured JUnit output and better test isolation than the default `cargo test`:

```yaml
- name: Install cargo-nextest
  uses: taiki-e/install-action@nextest

- name: Run Rust tests with JUnit output
  run: pnpm test:rust
```

The underlying command is `cargo nextest run --workspace --locked --config-file nextest.toml --profile ci`, which ensures the lockfile is respected and JUnit output is emitted for CI consumption.

### The Parallelism Strategy

None of the seven jobs depend on each other. They all start simultaneously:

| Job | Runner | Container | System Deps Required |
|-----|--------|-----------|---------------------|
| Format | `ubuntu-24.04` | No | Node.js, Rust |
| Lint | `ubuntu-24.04` | No | Node.js |
| Typecheck | `ubuntu-24.04` | No | Node.js |
| Frontend tests | `ubuntu-24.04` | No | Node.js |
| Rust checks | `ubuntu-24.04` | `tauri-ci-desktop` | WebKitGTK, GTK3 |
| Rust tests | `ubuntu-24.04` | `tauri-ci-desktop` | WebKitGTK, GTK3 |
| Release metadata | `ubuntu-24.04` | No | Node.js |

The frontend jobs finish in under a minute. The Rust jobs take longer due to compilation, but Rust caching (`swatinem/rust-cache@v2`) keeps incremental builds fast after the first run. Because nothing waits on anything else, the wall-clock time is determined by the slowest job, not the sum of all jobs.

### Workflow Summaries

Every job writes a `GITHUB_STEP_SUMMARY` block with structured output, so maintainers can scan the Actions summary page without opening individual logs:

```yaml
- name: Write summary
  if: always()
  run: |
    {
      echo "## Emoji Nook Rust Test Summary"
      echo
      echo "- Runner: \`ubuntu-24.04\`"
      echo "- Container: \`ghcr.io/liminal-hq/tauri-ci-desktop:latest\`"
      echo "- Rust tests: \`${{ steps.rust_tests.outcome }}\`"
      echo "- Test artefact: \`target/nextest/ci/junit.xml\`"
      echo "- Run URL: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
    } >> "${GITHUB_STEP_SUMMARY}"
```

The `if: always()` ensures summaries are written even on failure — that is when they are most useful.

## The Version Drift Problem

Emoji Nook uses a single release version for the whole workspace, but that version lives in six different files across two package ecosystems:

| File | Format | Ecosystem |
|------|--------|-----------|
| `package.json` | JSON | pnpm workspace root |
| `apps/emoji-picker/package.json` | JSON | pnpm app package |
| `apps/emoji-picker/src-tauri/tauri.conf.json` | JSON | Tauri bundler config |
| `apps/emoji-picker/src-tauri/Cargo.toml` | TOML | Rust app crate |
| `plugins/xdg-portal/Cargo.toml` | TOML | Rust plugin crate |
| `plugins/xdg-portal/guest-js/package.json` | JSON | Plugin TypeScript bindings |

If any of these get out of sync, the built artefacts carry mismatched version metadata. A `.deb` package might report one version while the Tauri about dialog shows another. Catching this at release time is too late.

### The Check Script

`scripts/check-release-versions.sh` runs on every CI pipeline execution. It extracts the version from each of the six files and fails if they do not all match:

```bash
FILE_SPECS=(
    "Workspace package.json|package.json|json"
    "Desktop package.json|apps/emoji-picker/package.json|json"
    "Tauri config|apps/emoji-picker/src-tauri/tauri.conf.json|json"
    "Desktop Cargo manifest|apps/emoji-picker/src-tauri/Cargo.toml|toml"
    "Plugin Cargo manifest|plugins/xdg-portal/Cargo.toml|toml"
    "Plugin guest JS package|plugins/xdg-portal/guest-js/package.json|json"
)
```

For JSON files, it uses Node.js to parse and extract the `version` field. For TOML files, it uses `sed` to grab the first `version = "..."` line. This avoids pulling in any TOML parsing dependency — the version line in a Cargo manifest is predictable enough that a simple regex works.

The script supports two modes: `--current-version` prints the synchronised version string (used by other scripts and CI), and the default mode prints a human-readable report listing every file and its version.

When versions drift, the output is clear:

```
Release version mismatch detected:
  - Workspace package.json:  0.2.0 (package.json)
  - Desktop package.json:    0.1.0 (apps/emoji-picker/package.json)
  ...
```

This check runs as the `release-metadata` job in CI and also runs inside the release workflow itself before building any artefacts.

## Release Preparation Tooling

Updating six files by hand is error-prone. The `scripts/prepare-release-version.sh` script handles the entire version bump in one command:

```bash
pnpm release:version:prepare -- --version 0.2.0
```

This script:

1. Validates that the working tree is clean (refuses to run on a dirty repo)
2. Normalises the version input (strips a leading `v`, validates semver format)
3. Creates a `chore/release-v0.2.0` branch from the current HEAD
4. Updates all six manifest files to the new version
5. Runs the check script to verify the update was consistent

JSON files are updated with a small inline Node.js one-liner that preserves the existing indentation (tabs in this project). TOML files use a Perl regex replacement scoped to the `version = "..."` line:

```bash
write_toml_version() {
    local file_path="$1"
    local current_version="$2"
    local new_version="$3"

    perl -0pi -e 's/^version = "\Q'"${current_version}"'\E"$/version = "'"${new_version}"'"/m' "$file_path"
}
```

After the updates, the script calls `check-release-versions.sh --current-version` as a self-test. If the resolved version does not match the intended new version, it fails rather than silently producing a partial update.

The script also supports `--dry-run` to preview what would change, `--no-branch` to update files on the current branch instead of creating a new one, and `--branch` to override the default branch name.

Critically, the script never creates tags and never pushes anything. It prepares files for review. The human operator still needs to commit, open a pull request, get it reviewed, merge, and then tag. This is deliberate — for a young release process, keeping humans in the loop at the publish step avoids automation surprises.

## The Release Workflow

The release workflow (`.github/workflows/release.yml`) triggers on `v*` tag pushes or manual `workflow_dispatch`. It has three jobs that run in sequence: prepare, build, and publish.

### Prepare Release

The `prepare-release` job resolves the release metadata and creates (or reuses) the GitHub Release:

1. Fetches `origin/main` and all tags
2. Resolves the tag — from the pushed tag on a tag event, or from a manual input, or by inferring `v` plus the synchronised workspace version
3. Validates the tag format against `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`
4. Verifies the tagged commit is an ancestor of `origin/main` — this prevents releasing from stale branches
5. Checks out the tagged commit and runs `check-release-versions.sh` to confirm the tag matches the manifest version
6. Creates a new GitHub Release or reuses an existing one for the same tag

The create-or-reuse logic is important for retryability. If a build fails after the release was created, re-running the workflow with the same tag will update the existing release rather than failing with a "release already exists" error:

```yaml
- name: Create or reuse GitHub Release
  run: |
    RELEASE_MATCH="$(
      gh api --paginate "repos/${GITHUB_REPOSITORY}/releases?per_page=100" \
        --jq ".[] | select(.tag_name == \"${TAG_NAME}\") | [.id, .html_url] | @tsv" \
        | head -n 1 || true
    )"

    if [[ -z "${RELEASE_MATCH}" ]]; then
      # Create new release...
    else
      # Reuse existing release...
    fi
```

The job also detects prereleases by checking for a hyphen in the tag (e.g., `v0.2.0-beta.1`) and marks the GitHub Release accordingly.

### Build Linux Release Bundles

The build job uses a matrix strategy to build for both x64 and arm64:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - runner: ubuntu-24.04
        arch_label: x64
        artefact_name: linux-release-assets-x64
      - runner: ubuntu-24.04-arm
        arch_label: arm64
        artefact_name: linux-release-assets-arm64
```

Each matrix leg runs inside the same `ghcr.io/liminal-hq/tauri-ci-desktop:latest` container used by CI, ensuring the build environment is identical between validation and release. The build produces three bundle formats:

```yaml
- name: Build Linux release bundles
  env:
    TAURI_BUNDLER_NEW_APPIMAGE_FORMAT: 'true'
  run: pnpm --filter @emoji-picker/emoji-picker tauri build --bundles appimage,deb,rpm
```

After building, the job collects all `.AppImage`, `.deb`, and `.rpm` files into a staging directory and generates a `SHA256SUMS` file:

```bash
(
  cd "${release_dir}"
  sha256sum ./* | sed 's# \./#  #' > SHA256SUMS
)
```

The staged assets are uploaded as workflow artefacts with architecture-specific names (`linux-release-assets-x64`, `linux-release-assets-arm64`), ready for the final publish step.

### Publish GitHub Release Assets

The publish job downloads artefacts from both architecture builds, merges them, and uploads everything to the GitHub Release:

```yaml
- name: Download Linux release assets
  uses: actions/download-artifact@v5
  with:
    pattern: linux-release-assets-*
    path: release-assets/linux
    merge-multiple: true

- name: Upload assets to GitHub Release
  run: gh release upload "${TAG_NAME}" release-assets/linux/* --clobber
```

The `--clobber` flag means re-running the workflow replaces existing assets rather than failing. Combined with the create-or-reuse release logic, this makes the entire workflow idempotent — a failed release can be retried by simply re-running the workflow.

## The Dual-Architecture Challenge

Building for both x64 and arm64 on GitHub Actions is straightforward in principle — GitHub provides both `ubuntu-24.04` (x64) and `ubuntu-24.04-arm` (arm64) runners. There is no cross-compilation involved. Each architecture builds natively on its own runner type.

The matrix strategy with `fail-fast: false` ensures that a failure on one architecture does not cancel the other build. If the arm64 build fails due to a transient issue, the x64 artefacts are still produced and uploaded.

Both builds use the same container image. The `ghcr.io/liminal-hq/tauri-ci-desktop:latest` image is published for both architectures from the organisation's shared `.github` repository, so the `container` directive works identically on both runner types.

The practical benefit of native builds over cross-compilation is significant: no cross-linker configuration, no sysroot management, no architecture-conditional dependency installation. The build command is identical on both legs of the matrix.

## The Operator Workflow

The end-to-end release process follows a review-first model:

1. **Prepare** — Run `pnpm release:version:prepare -- --version 0.2.0` from an up-to-date `main`. The script creates a `chore/release-v0.2.0` branch and updates all six manifests.

2. **Review** — Commit the changes, open a pull request against `main`, and confirm CI passes. The version drift check validates that all manifests match.

3. **Merge** — Merge the pull request into `main`. Confirm the merged commit passes CI.

4. **Tag** — Create and push an annotated tag from the merged commit:
   ```bash
   git tag -a v0.2.0 -m "Emoji Nook v0.2.0"
   git push origin v0.2.0
   ```

5. **Build** — The tag push triggers the release workflow. It builds AppImage, `.deb`, and `.rpm` for both x64 and arm64, generates checksums, and attaches everything to a GitHub Release with auto-generated notes.

6. **Smoke test** — Download the artefacts and test on at least one Wayland session and one X11 session: launch, invoke the picker, search, insert an emoji, verify the tray menu, and confirm settings persist.

The review-first design means no release goes out without a pull request. The version bump is visible in the diff, the CI pipeline validates it, and another human can review it before it merges. The tag is the explicit "ship it" action, and it only works if the tagged commit is on `main`.

If something goes wrong — a build failure, a missing asset — the operator can re-run the release workflow on the same tag. The workflow reuses the existing GitHub Release and overwrites any partial assets. No tag deletion, no force-pushing, no manual cleanup.

For draft rehearsals, `workflow_dispatch` supports a `release_draft` input that creates the release in draft state. This is useful for verifying the full pipeline without publishing anything visible to users.

## Wrapping Up

The CI and release setup for Emoji Nook is deliberately modest. Seven parallel CI jobs, a version-sync script, a release-prep helper, and a three-stage release workflow. No custom GitHub Actions, no complex matrix permutations, no release bots.

The key decisions that made this work smoothly:

- **Parallel jobs by concern, not by stage** — format, lint, typecheck, and tests all run simultaneously rather than in a pipeline. The slowest job determines feedback time, not the sum.
- **Prebuilt container images** — Rust and Tauri system dependencies are baked into a shared GHCR image, avoiding flaky `apt-get install` steps and keeping build times predictable.
- **Version drift as a CI gate** — catching manifest mismatches on every pull request means the release-prep script is the only way versions get bumped, not a recommended way.
- **Idempotent release workflow** — create-or-reuse releases and `--clobber` uploads mean failures are fixed by re-running, not by cleaning up state.
- **Review-first releases** — the automation handles building and publishing, but a human decides when to tag. The release-prep script deliberately stops short of creating tags or pushing.

If you are building a Tauri v2 app and need CI that covers both the frontend and backend ecosystems, hopefully this gives you a concrete starting point. The workflows, scripts, and documentation are all in the [Emoji Nook repository](https://github.com/liminal-hq/emoji-nook).

---

*(c) 2026 Liminal HQ, Scott Morris*
