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
