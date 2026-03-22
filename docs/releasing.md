# Releasing Emoji Nook

This document records the current release policy for Emoji Nook so documentation, metadata, and automation all point at the same process.

## Current status

CI validation is in place, a release version-drift check now runs in CI, and `.github/workflows/release.yml` defines the Linux GitHub Release flow for `x64` and `arm64` AppImage, `.deb`, `.rpm`, and `SHA256SUMS` assets.

Treat this document and [docs/release-checklist.md](docs/release-checklist.md) as the source of truth for release decisions and operator steps.

## Release versioning

Emoji Nook currently uses a single release version for the whole workspace.

The following files should move together for each app release:

- `package.json`
- `apps/emoji-picker/package.json`
- `apps/emoji-picker/src-tauri/tauri.conf.json`
- `apps/emoji-picker/src-tauri/Cargo.toml`
- `plugins/desktop-integration/Cargo.toml`
- `plugins/desktop-integration/guest-js/package.json`
- `plugins/xdg-portal/Cargo.toml`
- `plugins/xdg-portal/guest-js/package.json`

This keeps the desktop app, the local Rust plugin crates, and the guest JavaScript packages aligned while the plugins remain internal workspace components rather than separately published products.

When those manifest versions change, `Cargo.lock` should be refreshed in the same release-preparation pass so `cargo ... --locked` validation keeps working on the release branch.

## Maintainer commands

Use these helpers when preparing or validating a release:

```bash
pnpm release:version:check
pnpm release:version:prepare -- --current-version
pnpm release:version:prepare -- --version 0.2.0
pnpm release:version:prepare -- --version 0.2.0 --dry-run
```

The release-prep helper creates `chore/release-vX.Y.Z` by default, updates all release-facing version fields together, refreshes `Cargo.lock`, and refuses to run on a dirty working tree.

## Tags and branches

- Stable releases use annotated tags in the form `vX.Y.Z`.
- Prereleases are optional and use `vX.Y.Z-beta.N` or `vX.Y.Z-rc.N`.
- Release preparation should happen on a dedicated branch named `chore/release-vX.Y.Z`.

`main` remains the integration branch. Release preparation stays review-first: prepare the version bump on a branch, open a pull request, merge it, and tag the merged `main` commit.

## Release notes

Emoji Nook uses GitHub-generated release notes as the baseline release-notes policy for now.

Manual edits are expected when a release needs extra operator notes, especially for:

- Wayland and X11 behaviour differences
- Installation notes for AppImage, `.deb`, and `.rpm`
- Known limitations or manual upgrade guidance

The repository does not maintain a separate `CHANGELOG.md` at this stage.

## Planned release artefacts

The first public release target is Linux only, with these artefacts attached to GitHub Releases for both `x64` and `arm64` where bundling succeeds:

- AppImage
- `.deb`
- `.rpm`
- `SHA256SUMS`

GitHub Release names should use the product name plus the version, for example `Emoji Nook v0.1.0`.

## Operator workflow

Follow [docs/release-checklist.md](docs/release-checklist.md) when cutting or repairing a release.

## Packaging metadata

Bundle naming should stay consistent across:

- Tauri `productName`
- package metadata
- Linux desktop entry naming
- GitHub Release naming

Current bundle metadata uses `Emoji Nook` as the canonical product name and `Utility` as the Linux package category.
