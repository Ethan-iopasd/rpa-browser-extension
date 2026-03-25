from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["RPA_RUNTIME_DIR"] = str(ROOT / ".test_runtime")
os.environ["RPA_TASK_SCHEDULER_ENABLED"] = "0"
API_ROOT = ROOT / "services" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

HAS_IMPORT = True
try:
    from app.repositories.audit_repository import audit_repository  # noqa: E402
    from app.repositories.credential_repository import credential_repository  # noqa: E402
    from app.schemas.contracts import CredentialsCreateRequest  # noqa: E402
    from app.services.credential_service import create_credential, get_credential_secret  # noqa: E402
    from app.services.security_service import decrypt_secret, encrypt_secret, mask_sensitive_data  # noqa: E402
except ModuleNotFoundError:
    HAS_IMPORT = False


@unittest.skipUnless(HAS_IMPORT, "api dependencies are not installed")
class TestSecurityService(unittest.TestCase):
    def setUp(self) -> None:
        audit_repository.clear()
        credential_repository.clear()

    def test_mask_sensitive_data(self) -> None:
        payload = {
            "username": "admin",
            "password": "secret",
            "nested": {"apiToken": "abc", "normal": "ok"},
        }
        masked = mask_sensitive_data("root", payload)
        self.assertEqual(masked["password"], "***")
        self.assertEqual(masked["nested"]["apiToken"], "***")
        self.assertEqual(masked["nested"]["normal"], "ok")

    def test_encrypt_decrypt_roundtrip(self) -> None:
        encrypted = encrypt_secret("hello-world")
        decrypted = decrypt_secret(encrypted)
        self.assertEqual(decrypted, "hello-world")

    def test_credential_create_and_read(self) -> None:
        summary = create_credential(CredentialsCreateRequest(name="demo", value="pass123"))
        secret = get_credential_secret(summary.credentialId)
        self.assertEqual(secret.value, "pass123")


if __name__ == "__main__":
    unittest.main()
