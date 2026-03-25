from __future__ import annotations

import compileall
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    targets = [
        root / "services" / "api" / "app",
        root / "apps" / "agent" / "agent",
        root / "packages" / "flow-schema" / "scripts",
    ]
    success = True
    for target in targets:
        if not target.exists():
            print(f"skip missing target: {target}")
            continue
        ok = compileall.compile_dir(str(target), force=True, quiet=1)
        print(f"checked {target}: {'ok' if ok else 'failed'}")
        success = success and ok
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
