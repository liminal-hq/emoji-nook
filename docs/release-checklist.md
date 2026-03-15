# Emoji Nook Release Checklist

This checklist is the maintainer path for shipping Linux releases to GitHub Releases.

## Who can cut releases

Releases should be cut by a maintainer who has:

- write access to `liminal-hq/emoji-nook`
- permission to create Git tags and GitHub Releases
- access to at least one Wayland environment and one X11 environment for smoke testing

## Prepare the release PR

1. Start from an up-to-date `main`.
2. Choose the release version:
   - stable: `X.Y.Z`
   - prerelease: `X.Y.Z-beta.N` or `X.Y.Z-rc.N`
3. Run the release-prep helper:

   ```bash
   pnpm release:version:prepare -- --version 0.2.0
   ```

4. Review the generated branch and diff.
5. Run the strongest validation pass you can locally:
   - preferred: `pnpm validate`
   - minimum for release prep: `pnpm release:version:check` and the checks relevant to the files changed
6. Commit the release-prep branch and open a pull request against `main`.

## Merge and tag

1. Merge the release-prep pull request into `main`.
2. Confirm the merged `main` commit passed CI.
3. Create and push an annotated tag from the merged commit:

   ```bash
   git tag -a v0.2.0 -m "Emoji Nook v0.2.0"
   git push origin v0.2.0
   ```

4. Watch `.github/workflows/release.yml` until both jobs complete.

## Review the GitHub Release

1. Open the release URL from the workflow summary.
2. Confirm the release contains:
   - AppImage bundles for the Linux architectures we currently publish
   - `.deb` bundles for the Linux architectures we currently publish
   - `.rpm` bundles for the Linux architectures we currently publish
   - `SHA256SUMS`
3. Review the generated release notes and add any missing operator guidance:
   - installation notes that matter for this release
   - Wayland and X11 caveats
   - manual upgrade notes if updater support is still deferred

Stable tag pushes publish immediately. If you want a draft rehearsal first, use `workflow_dispatch` on `.github/workflows/release.yml` with `release_draft=true`.

## Post-release smoke test

Smoke test at least one Wayland session and one X11 session:

- launch Emoji Nook successfully
- open the picker from the configured shortcut
- search and insert at least one emoji into another application
- confirm the tray menu still opens and quits cleanly
- confirm settings persist after restart

## Failed release repair

- If the tagged commit is correct and the workflow fails before assets upload, rerun the failed workflow for that same tag.
- If the release exists but the asset upload failed, rerun the workflow or use `workflow_dispatch` with the same tag to reuse the existing release.
- If the wrong commit or wrong version was tagged, delete the GitHub Release and tag, fix the issue on `main`, and create a new correct tag instead of forcing the existing tag forward.
