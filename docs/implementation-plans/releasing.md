# Release Implementation Plan

This plan covers the work needed to take Emoji Nook from local development builds to repeatable public releases on GitHub. It is intentionally scoped to the current Linux-first product direction and the repository's present state.

## Goal

Produce signed, versioned, reproducible Linux release artefacts for Emoji Nook, published through GitHub Releases with enough automation that shipping a new version is routine rather than manual.

## Current State Review

The repository already has a good base for release work, but several pieces are still missing:

- Tauri bundling is enabled in `apps/emoji-picker/src-tauri/tauri.conf.json`
- App, frontend package, workspace package, and plugin manifests all carry explicit versions
- Linux icons are present for bundle generation
- There is no checked-in GitHub Actions workflow
- There is no documented version bump or tagging flow
- There is no release-note, changelog, signing, or updater strategy yet
- Packaging metadata is still minimal for Linux distribution

## Related Repository Review

Several related repositories already establish release patterns that Emoji Nook can reuse.

### `liminal-hq/threshold`

- Uses a dedicated `release-build.yml` workflow
- Supports both tag-driven and manual dispatch releases
- Creates or reuses the GitHub Release before build jobs start
- Builds release matrices per platform and architecture
- Validates that tagged commits are on `main`
- Publishes recent releases with `vX.Y.Z` tags

This is the closest organisational precedent for a Tauri desktop application.

### `ScottMorris/liminal-notes`

- Uses a `publish-desktop.yml` workflow for desktop builds
- Uses a `prepare-release` job with tag validation and create-or-reuse release logic
- Builds inside prebuilt GHCR CI containers rather than installing all system packages inline
- Uses a desktop-specific tag namespace: `desktop-vX.Y.Z`
- Attaches Tauri build outputs directly to the GitHub Release

This is the strongest precedent for containerised Tauri desktop release infrastructure.

### `liminal-hq/smdu`

- Uses a `release.yml` workflow with `vX.Y.Z` tags and manual dispatch support
- Creates or reuses GitHub Releases with generated notes
- Builds platform-specific assets in a matrix, then publishes them in a dedicated final job
- Generates checksum files alongside release artefacts

This is a strong precedent for clean release orchestration and checksum publication, even though it is not a Tauri app.

### `liminal-hq/.github`

- Publishes shared GHCR CI images for desktop and mobile Tauri pipelines
- Establishes an organisational pattern for centralised CI environments

This means Emoji Nook should prefer the existing shared Docker image approach rather than starting with a bespoke long-lived apt-install workflow.

### `liminal-hq/flow`

- Includes a small `scripts/prepare-release-version.sh` helper
- Updates release-facing version references before tagging
- Can print the current version, run as a dry run, and optionally create a release-prep branch automatically
- Keeps the human review and PR step in place rather than tagging immediately
- Uses workflow summaries in the release workflow itself

This is a good precedent for a low-ceremony release-preparation helper that reduces version drift without hiding the release process.

## Scope

### In scope

- Versioning policy and release cadence
- GitHub Actions workflows for validation and release builds
- Linux bundle metadata for AppImage, `.deb`, and `.rpm`
- GitHub Releases publication with attached artefacts
- Release notes and changelog process
- Optional groundwork for future in-app updates

### Out of scope

- Windows and macOS distribution
- Flatpak, Snap, or distro-native repository publishing
- crates.io or npm publication of the xdg-portal plugin
- Code-signing paths that depend on platforms we do not currently target

## Release Model

### Version source of truth

Adopt a single release version per app release and keep these files in sync:

- Root `package.json`
- `apps/emoji-picker/package.json`
- `apps/emoji-picker/src-tauri/tauri.conf.json`
- `apps/emoji-picker/src-tauri/Cargo.toml`
- `plugins/xdg-portal/Cargo.toml`
- `plugins/xdg-portal/guest-js/package.json` when plugin API changes require a matching published version

Recommendation: use the app release version as the workspace version anchor, even while the plugin remains unpublished.

### Release trigger

Use annotated Git tags in the form `vX.Y.Z`.

- `main` remains the integration branch
- A pushed tag triggers the production release workflow
- Optional prereleases use `vX.Y.Z-beta.N` or `vX.Y.Z-rc.N`

Recommendation: follow the `threshold` and `smdu` convention with plain `vX.Y.Z` tags unless Emoji Nook later needs multiple independently versioned release channels.

### Release artefacts

Initial artefacts should target Linux users directly:

- AppImage for broad portable distribution
- `.deb` for Debian/Ubuntu and derivatives
- `.rpm` for Fedora/openSUSE and derivatives
- Checksums file (`SHA256SUMS`)

## Implementation Phases

### Gate 1: Release foundations (Phases 1–2)

Define the versioning and metadata needed for a trustworthy package.

#### Phase 1: Version and branching policy

- [ ] Document the release flow in `README.md` or a dedicated release guide
- [ ] Decide whether plugin manifest versions always move with app releases or only when plugin surface changes
- [ ] Standardise tag format on `vX.Y.Z`
- [ ] Decide whether prereleases are needed before `1.0.0`
- [ ] Add a lightweight changelog policy:
  - Use GitHub-generated notes, or
  - Maintain `CHANGELOG.md`
- [ ] Decide whether release prep should happen on a dedicated branch by default, following the lightweight `flow` pattern

#### Phase 2: Package metadata hardening

- [ ] Expand `apps/emoji-picker/src-tauri/tauri.conf.json` bundle metadata:
  - `category`
  - `shortDescription`
  - `longDescription`
  - `copyright`
  - `publisher`
  - Linux package dependencies if required
- [ ] Confirm application naming is consistent across bundle metadata, desktop entry, and GitHub release naming
- [ ] Audit icons and confirm they are sufficient for AppImage, `.deb`, and `.rpm` outputs
- [ ] Add licence metadata where packaging surfaces require it
- [ ] Verify all user-facing packaging text uses Canadian English

**Gate 1 result: the project has a defined versioning model and complete Linux packaging metadata.**

### Gate 2: Build confidence (Phases 3–4)

Create repeatable CI so release builds start from a known-good state.

#### Phase 3: Validation workflow

- [ ] Add `.github/workflows/ci.yml`
- [ ] Run on pushes and pull requests to `main`
- [ ] Include:
  - `pnpm install --frozen-lockfile`
  - `pnpm build`
  - `cargo build --manifest-path apps/emoji-picker/src-tauri/Cargo.toml`
- [ ] Add caching for:
  - `pnpm` store
  - Cargo registry and target directories where worthwhile
- [ ] Use the `threshold` and `liminal-notes` CI workflows as the baseline structure for job naming, caching, and summaries
- [ ] Add a `GITHUB_STEP_SUMMARY` block to every CI job so maintainers can scan outcomes without opening raw logs
- [ ] Design CI summaries for Emoji Nook specifically:
  - Validation scope run in the job
  - Linux environment or container used
  - Result state for build, test, and upload steps
  - Links back to the workflow run when useful
- [ ] Decide whether a Linux GUI smoke test is needed now or can wait until desktop integration is further along

#### Phase 4: Version consistency checks

- [ ] Add a small script or workflow check that asserts all release version fields match
- [ ] Fail CI when `package.json`, `tauri.conf.json`, and Cargo manifest versions drift
- [ ] Add a changelog or release-notes presence check if the project adopts one
- [ ] Add a release-prep helper script, likely `scripts/prepare-release-version.sh`, that:
  - Prints the current release version
  - Updates all release-facing version fields together
  - Supports `--dry-run`
  - Optionally creates a release branch such as `chore/release-vX.Y.Z`
  - Stops on a dirty working tree
- [ ] Keep the helper script narrow in scope:
  - prepare files for review
  - do not create tags
  - do not push branches
  - do not publish releases
- [ ] Design the script around Emoji Nook's actual version-bearing files:
  - Root `package.json`
  - `apps/emoji-picker/package.json`
  - `apps/emoji-picker/src-tauri/tauri.conf.json`
  - `apps/emoji-picker/src-tauri/Cargo.toml`
  - `plugins/xdg-portal/Cargo.toml`
  - `plugins/xdg-portal/guest-js/package.json` when required
- [ ] If adopted, make the script the recommended maintainer path for starting a release PR
- [ ] Land the release-prep script and the first complete release workflow in the same implementation pass so maintainers get a full release path, not disconnected pieces

**Gate 2 result: every merge is validated, and version drift is caught before release day.**

### Gate 3: Ship artefacts (Phases 5–6)

Automate Linux builds and GitHub Releases.

#### Phase 5: Release workflow

- [ ] Add `.github/workflows/release.yml`
- [ ] Trigger on tags matching `v*`
- [ ] Support `workflow_dispatch` for maintainers, following the existing `prepare-release` pattern used in `threshold`, `liminal-notes`, and `smdu`
- [ ] Add a `prepare-release` job that:
  - Validates the tag format
  - Creates or reuses the GitHub Release
  - Exposes `tag_name` and `release_id` outputs for later jobs
- [ ] Build on GitHub-hosted Ubuntu runners using the shared GHCR Docker image pattern already established in `liminal-hq/.github` where possible
- [ ] Decide whether Emoji Nook can consume the shared desktop CI image directly or needs a small derived image for any extra Linux packaging dependencies
- [ ] Run `pnpm install --frozen-lockfile`
- [ ] Run the Tauri production build for the app
- [ ] Upload generated AppImage, `.deb`, and `.rpm` artefacts
- [ ] Generate `SHA256SUMS`
- [ ] Create or update the corresponding GitHub Release
- [ ] Add a workflow summary to every release job, including:
  - `prepare-release`: resolved tag, release name, created versus reused release, release URL
  - Linux build job: target platform, bundle formats found, checksum generation result, upload result
  - Final publish job if used: attached asset count, checksum file presence, final release URL
- [ ] Keep the summary tone product-specific and concise, for example `Emoji Nook Release Summary` rather than generic build text

#### Phase 6: Release notes and provenance

- [ ] Generate release notes automatically from GitHub, then allow manual edits when needed
- [ ] Include:
  - Supported desktop/session expectations
  - Known Wayland/X11 limitations
  - Installation notes for each artefact type
- [ ] Attach checksums to the release
- [ ] Decide whether to add build provenance or attestation in the first release wave
- [ ] Mirror the most important release metadata in the job summaries so maintainers can verify tag, assets, and release destination from the Actions UI alone

**Gate 3 result: pushing a release tag produces downloadable Linux packages on GitHub automatically.**

### Gate 4: Make releases maintainable (Phases 7–8)

Reduce human error and prepare for future update mechanisms.

#### Phase 7: Release operator workflow

- [ ] Add a documented release checklist under `docs/`
- [ ] Cover:
  - Version bump
  - Tag creation
  - CI verification
  - Release-note review
  - Post-release smoke test on at least one Wayland and one X11 environment
- [ ] Define who can cut releases and how failed releases are repaired
- [ ] Decide whether GitHub Releases are drafted first and published after manual verification

#### Phase 8: Updater readiness

- [ ] Evaluate `tauri-plugin-updater` for a later milestone
- [ ] Confirm whether chosen Linux artefacts and hosting strategy fit Tauri updater expectations
- [ ] If auto-update is deferred, document the manual upgrade story clearly in release notes
- [ ] Keep updater signing/secrets out of scope until the desktop integration path is stable

**Gate 4 result: release operations are documented, low-risk, and ready to evolve into in-app updates later.**

## Recommended Delivery Order

1. Finish package metadata and version policy.
2. Implement the release-prep version bump script and the first tag-driven GitHub Release workflow together.
3. Add CI validation and version drift checks around that release path.
4. Document the human release checklist and include the release-prep script in that flow.
5. Use the shared GHCR CI image setup from `liminal-hq/.github`, or a minimal derivative of it, for Linux build jobs.
6. Revisit updater support after desktop integration reaches production readiness.

## Risks and Mitigations

### Linux runner dependency drift

Tauri Linux builds depend on system libraries that can shift on GitHub-hosted runners. Mitigate by pinning the workflow image, installing dependencies explicitly, and keeping a local release build command documented.

### Version mismatch across manifests

This workspace has multiple version-bearing files. Mitigate with an automated consistency check and a single documented bump procedure.

### Over-automation in release preparation

Auto-creating a branch is helpful, but auto-tagging or auto-publishing would hide too much state for a young release process. Mitigate by keeping the helper script review-first, with branch creation optional and publication left to the normal PR and tag flow.

### Wayland/X11 behavioural differences

A package may install correctly while core behaviour still varies by compositor or session type. Mitigate with release smoke tests that cover both Wayland and X11 before publishing stable releases.

### Packaging metadata gaps

Minimal metadata can still build but leads to rough-looking installs and poor trust signals. Mitigate by completing Tauri bundle metadata before the first public release.

### Workflow visibility drift

Release automation becomes harder to trust when summaries are inconsistent across jobs. Mitigate by making per-job summaries part of the workflow definition of done and by using a small shared summary structure for Emoji Nook jobs.

## Definition of Done

This plan is complete when:

- A tagged release builds automatically on GitHub
- Linux artefacts are attached to a GitHub Release
- Release versions are synchronised across the workspace
- Release notes and checksums are published with each release
- A documented release checklist exists for maintainers
