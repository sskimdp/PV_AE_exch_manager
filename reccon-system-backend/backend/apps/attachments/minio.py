import io
import logging
import time
import uuid
from urllib.parse import urlparse

import boto3
from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    ConnectTimeoutError,
    ConnectionClosedError,
    EndpointConnectionError,
    ReadTimeoutError,
)
from django.conf import settings


logger = logging.getLogger(__name__)
_BUCKET_READY = False
_RETRYABLE_CONNECTION_ERRORS = (
    EndpointConnectionError,
    ConnectionClosedError,
    ConnectTimeoutError,
    ReadTimeoutError,
)


class AttachmentStorageError(RuntimeError):
    """Raised when object storage is unavailable or misconfigured."""


def _normalized_endpoint() -> str:
    raw = str(getattr(settings, "MINIO_ENDPOINT", "") or "").strip()
    if not raw:
        raise AttachmentStorageError("MINIO_ENDPOINT is not configured.")

    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        if not parsed.netloc:
            raise AttachmentStorageError("MINIO_ENDPOINT has an invalid URL value.")
        return parsed.netloc

    return raw.strip("/")


def _endpoint_url() -> str:
    scheme = "https" if settings.MINIO_USE_SSL else "http"
    return f"{scheme}://{_normalized_endpoint()}"


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=_endpoint_url(),
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        region_name=getattr(settings, "MINIO_REGION", "us-east-1"),
        verify=getattr(settings, "MINIO_VERIFY_SSL", True),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=getattr(settings, "MINIO_CONNECT_TIMEOUT", 10),
            read_timeout=getattr(settings, "MINIO_READ_TIMEOUT", 30),
            retries={
                "max_attempts": getattr(settings, "MINIO_MAX_RETRIES", 2),
                "mode": "standard",
            },
        ),
    )


def _extract_error_code(exc) -> str:
    response = getattr(exc, "response", None) or {}
    error = response.get("Error") or {}
    code = error.get("Code")
    if code is None:
        status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        code = str(status or "")
    return str(code or "")


def _is_bucket_missing_error(exc) -> bool:
    code = _extract_error_code(exc)
    return code in {"404", "NoSuchBucket", "NotFound"}


def ensure_bucket_exists(force_check: bool = False) -> None:
    global _BUCKET_READY

    if _BUCKET_READY and not force_check:
        return

    s3 = get_s3_client()
    bucket = settings.MINIO_BUCKET

    try:
        s3.head_bucket(Bucket=bucket)
        _BUCKET_READY = True
        return
    except ClientError as exc:
        if not _is_bucket_missing_error(exc):
            logger.exception("MinIO head_bucket failed for %s", bucket)
            raise AttachmentStorageError(
                f"MinIO head_bucket failed: {_extract_error_code(exc)}"
            ) from exc
    except _RETRYABLE_CONNECTION_ERRORS as exc:
        logger.exception("MinIO is not reachable during head_bucket for %s", bucket)
        raise AttachmentStorageError("MinIO is not reachable.") from exc
    except Exception as exc:  # pragma: no cover - defensive branch
        logger.exception("Unexpected MinIO error during head_bucket for %s", bucket)
        raise AttachmentStorageError("Unexpected MinIO head_bucket error.") from exc

    try:
        s3.create_bucket(Bucket=bucket)
    except ClientError as exc:
        code = _extract_error_code(exc)
        if code not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
            logger.exception("MinIO create_bucket failed for %s", bucket)
            raise AttachmentStorageError(
                f"MinIO create_bucket failed: {code}"
            ) from exc
    except _RETRYABLE_CONNECTION_ERRORS as exc:
        logger.exception("MinIO is not reachable during create_bucket for %s", bucket)
        raise AttachmentStorageError("MinIO is not reachable.") from exc
    except Exception as exc:  # pragma: no cover - defensive branch
        logger.exception("Unexpected MinIO error during create_bucket for %s", bucket)
        raise AttachmentStorageError("Unexpected MinIO create_bucket error.") from exc

    _BUCKET_READY = True


def _to_bytes_buffer(fileobj):
    if hasattr(fileobj, "seek"):
        fileobj.seek(0)
    content = fileobj.read()
    if content is None:
        content = b""
    if isinstance(content, str):
        content = content.encode("utf-8")
    if hasattr(fileobj, "seek"):
        fileobj.seek(0)
    return io.BytesIO(content), len(content)


def upload_fileobj(fileobj, *, content_type: str, filename: str) -> tuple[str, int]:
    """
    Upload в MinIO. Возвращает (storage_key, size)
    """
    ensure_bucket_exists()
    s3 = get_s3_client()
    key = f"{uuid.uuid4().hex}/{filename}"
    payload, size = _to_bytes_buffer(fileobj)

    put_kwargs = {
        "Bucket": settings.MINIO_BUCKET,
        "Key": key,
        "Body": payload,
        "ContentLength": size,
    }
    if content_type:
        put_kwargs["ContentType"] = content_type

    last_error = None
    for attempt in range(2):
        try:
            payload.seek(0)
            s3.put_object(**put_kwargs)
            return key, size
        except ClientError as exc:
            last_error = exc
            if _is_bucket_missing_error(exc) and attempt == 0:
                ensure_bucket_exists(force_check=True)
                continue
            logger.exception(
                "MinIO put_object failed for key=%s bucket=%s", key, settings.MINIO_BUCKET
            )
            raise AttachmentStorageError(
                f"MinIO put_object failed: {_extract_error_code(exc)}"
            ) from exc
        except _RETRYABLE_CONNECTION_ERRORS as exc:
            last_error = exc
            logger.warning(
                "Retryable MinIO upload error for key=%s on attempt %s",
                key,
                attempt + 1,
                exc_info=True,
            )
            if attempt == 0:
                time.sleep(2)
                ensure_bucket_exists(force_check=True)
                continue
            raise AttachmentStorageError("MinIO is not reachable.") from exc
        except Exception as exc:  # pragma: no cover - defensive branch
            logger.exception(
                "Unexpected MinIO error during put_object for key=%s bucket=%s",
                key,
                settings.MINIO_BUCKET,
            )
            raise AttachmentStorageError("Unexpected MinIO put_object error.") from exc

    raise AttachmentStorageError("MinIO upload failed.") from last_error


def delete_object(storage_key: str) -> None:
    s3 = get_s3_client()
    s3.delete_object(Bucket=settings.MINIO_BUCKET, Key=storage_key)


def stream_object(storage_key: str):
    s3 = get_s3_client()
    obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=storage_key)
    return obj["Body"]
