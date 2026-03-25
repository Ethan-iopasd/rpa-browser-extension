# GitHub Release Guide

This guide is the shortest path for turning the current workspace into a public GitHub release.

## What To Release

There are two reasonable release modes for this repository:

1. Source-only release
2. Windows desktop binary release

Use source-only releases when you want to share code snapshots quickly. Use desktop binary releases when you want to ship the installer, manifest, and sidecar-based runtime to end users.

## Recommended Versioning

- Tag format: `vX.Y.Z`
- Pre-release tag format: `vX.Y.Z-beta.N`
- Keep the Git tag, GitHub release title, and packaged desktop version aligned

Example:

- Git tag: `v0.1.0`
- GitHub release title: `v0.1.0`
- Desktop output folder: `v2/dist/desktop/0.1.0`

## Pre-Release Checklist

1. Make sure `main` is clean and pushed.
2. Run verification:

```powershell
cd v2
pnpm verify
```

3. If publishing the desktop build, build the Python sidecar first:

```powershell
cd v2
pnpm release:desktop:sidecar
```

4. Build the desktop installer:

```powershell
cd v2
pnpm release:desktop
```

5. Confirm the expected outputs exist:
   - `v2/dist/desktop/<version>/bundle`
   - `v2/dist/desktop/<version>/desktop-release-manifest.json`

## Assets To Upload

For a Windows desktop release, upload at least:

1. `RPA Flow Desktop_<version>_x64-setup.exe`
2. `desktop-release-manifest.json`

Optional:

1. Additional bundle artifacts from the same `bundle` directory
2. Checksums file if you generate one outside the manifest
3. A zipped source snapshot if you want a hand-curated source bundle in addition to GitHub's automatic source archives

## Create The Git Tag

```powershell
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "v0.1.0"
git push origin main --tags
```

## Create The GitHub Release

On GitHub:

1. Open `Releases` -> `Draft a new release`
2. Select the new tag
3. Use the same value for the release title
4. Mark as pre-release when publishing beta builds
5. Upload the installer and manifest
6. Publish the release after asset verification

## Suggested Release Notes Template

```md
## Highlights
- 

## Included Components
- Designer
- API
- Agent
- Recorder extension
- Desktop shell

## Verification
- `pnpm verify`
- Desktop installer smoke-tested on Windows

## Assets
- `RPA Flow Desktop_<version>_x64-setup.exe`
- `desktop-release-manifest.json`

## Known Limitations
- Windows-first release
- Deep technical docs are still mostly in Chinese
```

## Recommended Release Naming

- Stable: `v0.1.0`
- Pre-release: `v0.1.0-beta.1`

## Notes For This Repository

- The current desktop distribution path is `v2/dist/desktop/<version>/`.
- The desktop build depends on the Python sidecar flow described in [`../README.md`](../README.md).
- The release scripts are documented in [`../scripts/release/README.md`](../scripts/release/README.md).
- The project currently uses reinstall-based updates instead of built-in auto-update.
