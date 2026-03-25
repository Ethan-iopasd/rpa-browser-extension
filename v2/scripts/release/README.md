# Release Scripts

## Beta ZIP (Legacy)

Build:

```powershell
cd v2
powershell -ExecutionPolicy Bypass -File .\scripts\release\build_beta_package.ps1 -Version 0.5.0-beta
```

Upgrade:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release\upgrade_beta.ps1 -PackagePath .\dist\rpa-flow-v2-0.5.0-beta.zip -TargetDir D:\RPAFlowV2
```

## Desktop Installer (Stage 3)

## Recommended First Public Release

Target the first public GitHub release as `v0.1.0-beta.1` and publish it as a GitHub pre-release, not a stable latest release.

Recommended command sequence:

```powershell
cd v2
pnpm verify
pnpm release:desktop:sidecar
pnpm release:desktop
pnpm pack:recorder-extension
```

Recommended release notes source:

1. `releases\v0.1.0-beta.1.md`

Build Python API sidecar only (recommended before first desktop release build):

```powershell
cd v2
pnpm release:desktop:sidecar
```

Standard release build:

```powershell
cd v2
pnpm release:desktop
```

Fast build (skip checks):

```powershell
cd v2
pnpm release:desktop:fast
```

Manifest-only validation (skip checks and skip build):

```powershell
cd v2
powershell -ExecutionPolicy Bypass -File .\scripts\release\build_desktop_installer.ps1 -SkipChecks -SkipBuild
```

If Chromium is already cached and you want to skip browser install during sidecar build:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release\build_desktop_installer.ps1 -SkipPlaywrightInstall
```

Output:

1. Installer artifacts: `dist\desktop\<version>\bundle`
2. Manifest with checksums: `dist\desktop\<version>\desktop-release-manifest.json`
3. Recorder extension archive: `dist\recorder-extension-<timestamp>.zip`

## Suggested GitHub Release Assets

When publishing an open-source GitHub release, upload:

1. `RPA Flow Desktop_0.1.0-beta.1_x64-setup.exe`
2. `desktop-release-manifest.json`
3. `recorder-extension-<timestamp>.zip`

Recommended release posture:

1. Mark it as a GitHub `pre-release`
2. Do not mark it as the latest stable release
3. Keep the desktop installer as the primary download and treat the recorder extension as optional

Recommended Git tag format:

1. Stable: `vX.Y.Z`
2. Pre-release: `vX.Y.Z-beta.N`
