"""Bounded, read-only Bilibili reader. Never starts MCP or exposes account writes.

Reading flow adapted from Yuuyuko-uu/dsh-bili-subagent 0.8.7 and its
vendor/bilibili-mcp (MIT, Copyright (c) 2026 AGI_Ananas). See LICENSE.
"""
import asyncio
import base64
import io
import json
import os
import re
import socket
import ipaddress
import sys
from pathlib import Path
from urllib.parse import urlparse

# Framework Python on macOS may have no populated default CA store. Keep TLS
# verification enabled and explicitly use the dependency's Mozilla CA bundle.
import certifi
os.environ["SSL_CERT_FILE"] = certifi.where()


def checked_ips(addresses):
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError("bili_subtitle_url_denied")
    return list(dict.fromkeys(addresses))


async def public_ips(host):
    import aiohttp
    addresses = [a[4][0] for a in await asyncio.to_thread(socket.getaddrinfo, host, 443, 0, socket.SOCK_STREAM)]
    # Local proxy DNS can return benchmarking fake IPs. Resolve that specific
    # case over verified HTTPS DNS, then pin the actual public address below.
    if addresses and all(ipaddress.ip_address(a) in ipaddress.ip_network("198.18.0.0/15") for a in addresses):
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(resolver=PinnedResolver(["1.1.1.1"])), timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get("https://cloudflare-dns.com/dns-query", params={"name": host, "type": "A"}, headers={"Accept": "application/dns-json"}, allow_redirects=False) as response:
                if response.status != 200:
                    raise ValueError("bili_subtitle_dns_failed")
                raw = await response.content.read(32769)
                if len(raw) > 32768:
                    raise ValueError("bili_subtitle_dns_failed")
                data = json.loads(raw)
                if data.get("Status") != 0:
                    raise ValueError("bili_subtitle_dns_failed")
                addresses = [a.get("data", "") for a in data.get("Answer", []) if a.get("type") == 1]
    return checked_ips(addresses)


class PinnedResolver:
    def __init__(self, addresses):
        self.addresses = addresses

    async def resolve(self, host, port=0, family=socket.AF_INET):
        return [{"hostname": host, "host": a, "port": port, "family": socket.AF_INET6 if ":" in a else socket.AF_INET, "proto": 0, "flags": 0} for a in self.addresses]

    async def close(self):
        pass


def bvid(value):
    if not isinstance(value, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", value):
        raise ValueError("bili_invalid_bvid")
    return value


async def subtitle_data(url):
    import aiohttp
    if url.startswith("//"):
        url = "https:" + url
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or u.username or u.password or u.port not in (None, 443) or not any(host == d or host.endswith("." + d) for d in ("hdslb.com", "bilivideo.com", "bilibili.com")):
        raise ValueError("bili_subtitle_url_denied")
    addresses = await public_ips(host)
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(resolver=PinnedResolver(addresses)), timeout=aiohttp.ClientTimeout(total=15)) as session:
        async with session.get(url, allow_redirects=False) as response:
            if response.status != 200:
                raise ValueError("bili_subtitle_fetch_failed")
            chunks, size = [], 0
            async for chunk in response.content.iter_chunked(32768):
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    raise ValueError("bili_subtitle_too_large")
                chunks.append(chunk)
            return json.loads(b"".join(chunks))


async def run(req):
    op, args = req.get("operation"), req.get("payload") or {}
    if op == "qr":
        import qrcode
        url = args.get("url", "")
        if not url.startswith("https://") or "bilibili.com" not in (urlparse(url).hostname or "") or len(url) > 4096:
            raise ValueError("bili_invalid_qr")
        image = qrcode.make(url)
        out = io.BytesIO()
        image.save(out, format="PNG")
        return {"image": base64.b64encode(out.getvalue()).decode()}
    if op not in ("search", "video", "subtitle", "comments", "check"):
        raise ValueError("bili_operation_denied")
    from bilibili_api import Credential, video, search, comment
    # Force the audited aiohttp backend rather than an optional curl executable.
    from bilibili_api import select_client
    select_client("aiohttp")
    file = Path(os.environ["LILITH_BILI_CREDENTIAL"])
    data = json.loads(file.read_text()) if file.exists() else {}
    if op != "search" and not data.get("sessdata"):
        return {"logged_in": False} if op == "check" else {"error": "bili_login_required"}
    cred = Credential(**{k: str(data.get(k) or "") for k in ("sessdata", "bili_jct", "buvid3", "dedeuserid")}) if data else None
    if op == "check":
        try:
            valid = await cred.check_valid()
            return {"logged_in": bool(valid)}
        except Exception:
            return {"error": "bili_login_check_failed"}
    if op == "search":
        keyword = args.get("query", "")
        if not isinstance(keyword, str) or not 1 <= len(keyword) <= 80:
            raise ValueError("bili_invalid_query")
        result = await search.search_by_type(keyword=keyword, search_type=search.SearchObjectType.VIDEO, page=1, order_type=search.OrderVideo.TOTALRANK)
        return {"videos": [{"bvid": x.get("bvid"), "title": re.sub("<[^>]*>", "", x.get("title", ""))[:160], "author": str(x.get("author", ""))[:80], "description": str(x.get("description", ""))[:400], "pubdate": x.get("pubdate", 0)} for x in (result.get("result") or [])[:8] if re.fullmatch(r"BV[0-9A-Za-z]{10}", str(x.get("bvid", "")))]}
    ident = bvid(args.get("bvid"))
    v = video.Video(bvid=ident, credential=cred)
    info = await v.get_info()
    if op == "video":
        pages = info.get("pages") or []
        return {"bvid": ident, "title": str(info.get("title", ""))[:160], "author": str(info.get("owner", {}).get("name", ""))[:80], "description": str(info.get("desc", ""))[:3000], "pages": len(pages), "duration": info.get("duration", 0), "cid": info.get("cid") or (pages[0].get("cid") if pages else 0)}
    if op == "comments":
        response = await comment.get_comments(oid=info["aid"], type_=comment.CommentResourceType.VIDEO, page_index=1, order=comment.OrderType.LIKE, credential=cred)
        return {"comments": [{"text": str(x.get("content", {}).get("message", ""))[:500], "likes": x.get("like", 0)} for x in (response.get("replies") or [])[:5]]}
    pages = info.get("pages") or []
    cid = info.get("cid") or (pages[0].get("cid") if pages else 0)
    if not cid:
        return {"text": "", "state": "no_subtitle", "scope": "first_part"}
    subtitles = (await v.get_subtitle(cid=cid)).get("subtitles") or []
    if not subtitles:
        return {"text": "", "state": "no_subtitle", "scope": "first_part"}
    target = next((s for s in subtitles if s.get("lan") in ("ai-zh", "zh-CN", "zh")), subtitles[0])
    body = await subtitle_data(target.get("subtitle_url", ""))
    text = "\n".join(str(x.get("content", "")) for x in body.get("body", []))
    return {"text": text[:24000], "state": "truncated" if len(text) > 24000 else "complete", "scope": "first_part", "language": str(target.get("lan", ""))[:30], "segments": len(body.get("body", []))}


def main():
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise ValueError("bili_request_too_large")
        result = asyncio.run(asyncio.wait_for(run(json.loads(raw)), timeout=24))
    except Exception as exc:
        # Never serialize exceptions from a network library: they can include cookies.
        message = str(exc)
        result = {"error": message if re.fullmatch(r"bili_[a-z_]+", message) else "bili_read_failed"}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
