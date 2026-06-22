from __future__ import annotations

import ipaddress
import logging
import shutil
import tempfile
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

_reader: object | None = None
_LAN = ("LAN", "Local Network")


def _is_private(ip_str: str) -> bool:
    try:
        return ipaddress.ip_address(ip_str).is_private
    except ValueError:
        return False


def _load_reader() -> object | None:
    try:
        import geoip2.database
        path = settings.geoip_db_path
        if path.exists():
            reader = geoip2.database.Reader(str(path))
            logger.info("GeoIP database loaded: %s", path)
            return reader
        logger.warning("GeoIP database not found at %s", path)
    except Exception:
        logger.warning("Failed to load GeoIP database", exc_info=True)
    return None


def _get_reader() -> object | None:
    global _reader
    if _reader is None:
        _reader = _load_reader()
    return _reader


def reload_database() -> bool:
    global _reader
    if _reader is not None:
        try:
            _reader.close()  # type: ignore[union-attr]
        except Exception:
            pass
    _reader = _load_reader()
    return _reader is not None


def lookup_country(ip: str) -> tuple[str, str] | None:
    if _is_private(ip):
        return _LAN

    reader = _get_reader()
    if reader is None:
        return None
    try:
        resp = reader.country(ip)  # type: ignore[union-attr]
        code = resp.country.iso_code or "XX"
        name = resp.country.name or "Unknown"
        return (code, name)
    except Exception:
        return None


def download_database(url: str, dest: Path | None = None) -> Path:
    import httpx

    dest = dest or settings.geoip_db_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=dest.parent, suffix=".mmdb.tmp", delete=False
    ) as tmp:
        tmp_path = Path(tmp.name)
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=120) as resp:
            resp.raise_for_status()
            with open(tmp_path, "wb") as f:
                for chunk in resp.iter_bytes(8192):
                    f.write(chunk)
        shutil.move(str(tmp_path), str(dest))
        logger.info("GeoIP database downloaded to %s", dest)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    reload_database()
    return dest


def get_status() -> dict:
    path = settings.geoip_db_path
    available = path.exists()
    result: dict = {
        "available": available,
        "file_path": str(path),
    }
    if available:
        stat = path.stat()
        result["file_size"] = stat.st_size
        from datetime import datetime, timezone
        result["last_modified"] = datetime.fromtimestamp(
            stat.st_mtime, tz=timezone.utc
        ).isoformat()
    return result
