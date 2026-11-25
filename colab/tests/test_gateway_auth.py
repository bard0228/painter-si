"""
Gateway 驗證邊界測試 (Testing Seam)
驗證：
1. 無 Token -> 401
2. 偽造 Token -> 401
3. 非白名單 Email -> 403
4. 白名單已驗證 Email -> 200 (含 GPU 與 VRAM 模式)
"""

import os
import sys
import unittest
from pathlib import Path

os.environ["HUISHI_ALLOWED_EMAIL"] = "artist@example.com"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
import backend_gateway  # noqa: E402


class TestBackendGatewayAuth(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(backend_gateway.app)

    def test_missing_token_returns_401(self) -> None:
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 401)

    def test_forged_token_returns_401(self) -> None:
        def reject_token(_token: str):
            raise ValueError("Invalid signature")

        backend_gateway.set_token_verifier(reject_token)
        res = self.client.get("/health", headers={"Authorization": "Bearer forged.jwt.token"})
        self.assertEqual(res.status_code, 401)

    def test_non_whitelisted_email_returns_403(self) -> None:
        backend_gateway.set_token_verifier(
            lambda _t: {"email": "stranger@example.com", "email_verified": True}
        )
        res = self.client.get("/health", headers={"Authorization": "Bearer valid.stranger.token"})
        self.assertEqual(res.status_code, 403)

    def test_whitelisted_email_returns_200_with_vram_mode(self) -> None:
        backend_gateway.set_token_verifier(
            lambda _t: {"email": "artist@example.com", "email_verified": True}
        )
        res = self.client.get("/health", headers={"Authorization": "Bearer valid.artist.token"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "online")
        self.assertIn("gpu_name", body)
        self.assertIn(body["vram_mode"], ("high_vram", "low_vram"))
        self.assertIn("+08:00", body["checked_at_taipei"])


if __name__ == "__main__":
    unittest.main()
