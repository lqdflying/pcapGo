from __future__ import annotations

import ipaddress
import logging
import shutil
import socket
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlparse

from app.config import settings

logger = logging.getLogger(__name__)

_LAN = ("LAN", "Local Network")
_RESERVED = (None, None)
_CHUNK_SIZE = 1024 * 1024

_READER_LOCK = threading.RLock()
_reader: object | None = None
_reader_attempted = False
_reader_path: Path | None = None


class GeoIPError(Exception):
    """Base error for expected GeoIP management failures."""

    status_code = 400
    public_detail = "GeoIP database operation failed"

    def __init__(self, public_detail: str | None = None) -> None:
        if public_detail is not None:
            self.public_detail = public_detail
        super().__init__(self.public_detail)


class GeoIPInvalidURLError(GeoIPError):
    public_detail = "GeoIP download URL must be a public http(s) URL"


class GeoIPDownloadError(GeoIPError):
    public_detail = "GeoIP database download failed"


class GeoIPSizeExceededError(GeoIPError):
    status_code = 413

    def __init__(self, max_bytes: int) -> None:
        super().__init__(
            f"GeoIP database exceeds the configured size limit of {max_bytes // (1024 * 1024)} MB"
        )


class GeoIPValidationError(GeoIPError):
    public_detail = "File is not a valid GeoIP2 Country database"


def max_database_bytes() -> int:
    return settings.geoip_max_db_mb * 1024 * 1024


def _classify_address(ip_str: str) -> tuple[str, str] | None:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return None

    if (
        ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
    ):
        return _RESERVED

    if ip.version == 4:
        private_v4 = tuple(
            ipaddress.ip_network(cidr)
            for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        )
        if any(ip in net for net in private_v4):
            return _LAN
    elif ip.version == 6 and ip in ipaddress.ip_network("fc00::/7"):
        return _LAN

    return None


def _is_forbidden_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise GeoIPInvalidURLError("GeoIP download URL host cannot be resolved") from exc

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            raise GeoIPInvalidURLError()
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_unspecified
            or ip.is_reserved
        ):
            return True
    return False


def validate_download_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise GeoIPInvalidURLError()
    if parsed.username or parsed.password:
        raise GeoIPInvalidURLError("GeoIP download URL must not contain credentials")
    if _is_forbidden_host(parsed.hostname):
        raise GeoIPInvalidURLError()
    return parsed.geturl()


def _open_country_reader(path: Path) -> object:
    try:
        import geoip2.database

        reader = geoip2.database.Reader(str(path))
        # Ensure this is usable as a Country database. AddressNotFoundError is
        # acceptable for sparse databases; TypeError/InvalidDatabaseError is not.
        try:
            reader.country("8.8.8.8")
        except Exception as exc:  # imported lazily to keep import-time robust
            import geoip2.errors

            if not isinstance(exc, geoip2.errors.AddressNotFoundError):
                reader.close()
                raise
        return reader
    except Exception as exc:
        raise GeoIPValidationError() from exc


def validate_database_file(path: Path) -> None:
    reader = _open_country_reader(path)
    try:
        pass
    finally:
        try:
            reader.close()  # type: ignore[union-attr]
        except Exception:
            logger.debug("Failed to close temporary GeoIP reader", exc_info=True)


def _load_reader(path: Path | None = None) -> object | None:
    path = path or settings.geoip_db_path
    if not path.exists():
        logger.info("GeoIP database not found at %s", path)
        return None
    try:
        reader = _open_country_reader(path)
        logger.info("GeoIP database loaded: %s", path)
        return reader
    except GeoIPValidationError:
        logger.warning("Failed to load GeoIP database from %s", path, exc_info=True)
        return None


def _get_reader() -> object | None:
    global _reader, _reader_attempted, _reader_path
    path = settings.geoip_db_path
    with _READER_LOCK:
        if _reader is not None and _reader_path == path:
            return _reader
        if _reader_attempted and _reader_path == path:
            return None
        _reader = _load_reader(path)
        _reader_attempted = True
        _reader_path = path
        return _reader


def reload_database() -> bool:
    global _reader, _reader_attempted, _reader_path
    path = settings.geoip_db_path
    new_reader = _load_reader(path)
    with _READER_LOCK:
        old_reader = _reader
        _reader = new_reader
        _reader_attempted = True
        _reader_path = path
    if old_reader is not None:
        try:
            old_reader.close()  # type: ignore[union-attr]
        except Exception:
            logger.debug("Failed to close previous GeoIP reader", exc_info=True)
    return new_reader is not None


def lookup_country(ip: str) -> tuple[str, str] | None:
    classification = _classify_address(ip)
    if classification == _LAN:
        return _LAN
    if classification == _RESERVED:
        return None

    reader = _get_reader()
    if reader is None:
        return None
    try:
        with _READER_LOCK:
            resp = reader.country(ip)  # type: ignore[union-attr]
        code = resp.country.iso_code or "XX"
        name = resp.country.name or "Unknown"
        return (code, name)
    except Exception:
        return None


def country_code_to_flag(code: str | None) -> str:
    normalized = code.strip().upper() if code else ""
    if normalized in {"", "LAN", "XX"} or len(normalized) != 2 or not normalized.isalpha():
        return ""
    base = 0x1F1E6
    c1 = ord(normalized[0]) - ord("A")
    c2 = ord(normalized[1]) - ord("A")
    if not (0 <= c1 <= 25 and 0 <= c2 <= 25):
        return ""
    return chr(base + c1) + chr(base + c2)


def _copy_stream_with_limit(src, dest_path: Path, max_bytes: int) -> int:
    written = 0
    with open(dest_path, "wb") as f:
        while True:
            chunk = src.read(_CHUNK_SIZE)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise GeoIPSizeExceededError(max_bytes)
            f.write(chunk)
    return written


def install_database_file(source: Path, dest: Path | None = None) -> Path:
    dest = dest or settings.geoip_db_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    max_bytes = max_database_bytes()
    if source.stat().st_size > max_bytes:
        raise GeoIPSizeExceededError(max_bytes)
    validate_database_file(source)
    with tempfile.NamedTemporaryFile(dir=dest.parent, suffix=".mmdb.tmp", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        shutil.copyfile(source, tmp_path)
        validate_database_file(tmp_path)
        shutil.move(str(tmp_path), str(dest))
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    reload_database()
    return dest


def download_database(url: str, dest: Path | None = None) -> Path:
    import httpx

    url = validate_download_url(url)
    dest = dest or settings.geoip_db_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    max_bytes = max_database_bytes()
    with tempfile.NamedTemporaryFile(dir=dest.parent, suffix=".mmdb.tmp", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        with httpx.Client(follow_redirects=False, timeout=120) as client:
            current_url = url
            for _ in range(5):
                validate_download_url(current_url)
                with client.stream("GET", current_url) as resp:
                    if resp.status_code in {301, 302, 303, 307, 308}:
                        location = resp.headers.get("location")
                        if not location:
                            raise GeoIPDownloadError("GeoIP download redirect did not include a Location header")
                        current_url = str(resp.url.join(location))
                        continue
                    resp.raise_for_status()
                    content_length = resp.headers.get("content-length")
                    if content_length and int(content_length) > max_bytes:
                        raise GeoIPSizeExceededError(max_bytes)
                    written = 0
                    with open(tmp_path, "wb") as f:
                        for chunk in resp.iter_bytes(_CHUNK_SIZE):
                            written += len(chunk)
                            if written > max_bytes:
                                raise GeoIPSizeExceededError(max_bytes)
                            f.write(chunk)
                    break
            else:
                raise GeoIPDownloadError("GeoIP download followed too many redirects")
        validate_database_file(tmp_path)
        shutil.move(str(tmp_path), str(dest))
        logger.info("GeoIP database downloaded to %s", dest)
    except GeoIPError:
        tmp_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        raise GeoIPDownloadError() from exc
    reload_database()
    return dest


def get_status() -> dict:
    path = settings.geoip_db_path
    available = path.exists()
    result: dict = {
        "available": available,
        "file_path": str(path),
        "file_name": path.name,
        "max_size_bytes": max_database_bytes(),
    }
    if available:
        stat = path.stat()
        result["file_size"] = stat.st_size
        from datetime import datetime, timezone

        result["last_modified"] = datetime.fromtimestamp(
            stat.st_mtime, tz=timezone.utc
        ).isoformat()
    return result
