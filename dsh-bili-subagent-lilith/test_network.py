import asyncio
import importlib.util
import socket
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("reader", Path(__file__).with_name("read_worker.py"))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class NetworkBoundaries(unittest.IsolatedAsyncioTestCase):
    def test_public_addresses(self):
        self.assertEqual(reader.checked_ips(["1.1.1.1", "1.1.1.1"]), ["1.1.1.1"])
        for address in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "198.18.0.1", "::1"]:
            with self.assertRaisesRegex(ValueError, "bili_subtitle_url_denied"):
                reader.checked_ips([address])

    async def test_url_boundaries(self):
        for url in ["http://aisubtitle.hdslb.com/a", "https://evil.example/a", "https://hdslb.com.evil.example/a", "https://user:pass@aisubtitle.hdslb.com/a", "https://aisubtitle.hdslb.com:8000/a"]:
            with self.assertRaisesRegex(ValueError, "bili_subtitle_url_denied"):
                await reader.subtitle_data(url)

    async def test_private_dns_fails_closed(self):
        with patch.object(socket, "getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaisesRegex(ValueError, "bili_subtitle_url_denied"):
                await reader.public_ips("aisubtitle.hdslb.com")

    async def test_pinned_resolution(self):
        result = await reader.PinnedResolver(["1.1.1.1"]).resolve("cloudflare-dns.com", 443)
        self.assertEqual(result[0]["hostname"], "cloudflare-dns.com")
        self.assertEqual(result[0]["host"], "1.1.1.1")


if __name__ == "__main__":
    unittest.main()
