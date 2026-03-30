import uuid

import boto3
from botocore.config import Config
from django.conf import settings


def _endpoint_url():
    scheme = "https" if settings.MINIO_USE_SSL else "http"
    return f"{scheme}://{settings.MINIO_ENDPOINT}"


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=_endpoint_url(),
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        region_name="us-east-1",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )


def ensure_bucket_exists():
    s3 = get_s3_client()
    bucket = settings.MINIO_BUCKET
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception:
        s3.create_bucket(Bucket=bucket)


def upload_fileobj(fileobj, *, content_type: str, filename: str) -> tuple[str, int]:
    """
    Upload в MinIO. Возвращает (storage_key, size)
    """
    ensure_bucket_exists()
    s3 = get_s3_client()

    key = f"{uuid.uuid4().hex}/{filename}"

    fileobj.seek(0, 2)
    size = fileobj.tell()
    fileobj.seek(0)

    put_kwargs = {
        "Bucket": settings.MINIO_BUCKET,
        "Key": key,
        "Body": fileobj.read(),
        "ContentLength": size,
    }
    if content_type:
        put_kwargs["ContentType"] = content_type

    s3.put_object(**put_kwargs)
    return key, size


def delete_object(storage_key: str) -> None:
    s3 = get_s3_client()
    s3.delete_object(Bucket=settings.MINIO_BUCKET, Key=storage_key)


def stream_object(storage_key: str):
    s3 = get_s3_client()
    obj = s3.get_object(Bucket=settings.MINIO_BUCKET, Key=storage_key)
    return obj["Body"]