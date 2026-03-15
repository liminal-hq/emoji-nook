# Releasing Emoji Nook

This document records the current release policy for Emoji Nook so documentation, metadata, and automation all point at the same process.

## Current status

Emoji Nook does not yet publish GitHub Releases automatically. CI validation is in place, and release-specific automation is being added in stages.

Until the release workflow lands, treat this document as the source of truth for release decisions and naming.

## Release versioning

Emoji Nook currently uses a single release version for the whole workspace.

The following files should move together for each app release:

- `package.json`
- `apps/emoji-picker/package.json`
- `apps/emoji-picker/src-tauri/tauri.conf.json`
- `apps/emoji-picker/src-tauri/Cargo.toml`
- `plugins/xdg-portal/Cargo.toml`
- `plugins/xdg-portal/guest-js/package.json`

This keeps the desktop app, the local Rust plugin crate, and the guest JavaScript package aligned while the plugin remains an internal workspace component rather than a separately published product.

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

The first public release target is Linux only, with these artefacts attached to GitHub Releases:

- AppImage
- `.deb`
- `.rpm`
- `SHA256SUMS`

GitHub Release names should use the product name plus the version, for example `Emoji Nook v0.1.0`.

## Packaging metadata

Bundle naming should stay consistent across:

- Tauri `productName`
- package metadata
- Linux desktop entry naming
- GitHub Release naming

Current bundle metadata uses `Emoji Nook` as the canonical product name and `Utility` as the Linux package category.
