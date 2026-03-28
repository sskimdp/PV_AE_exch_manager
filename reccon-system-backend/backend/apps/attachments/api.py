from urllib.parse import urlencode

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.attachments.minio import delete_object, stream_object
from apps.attachments.models import Attachment
from apps.audit.service import write_audit
from apps.messages.models import Message


DOWNLOAD_SIGNER_SALT = "attachments.download"
DEFAULT_DOWNLOAD_TOKEN_MAX_AGE = 60 * 60 * 24  # 24 часа


def get_download_signer() -> TimestampSigner:
    return TimestampSigner(salt=DOWNLOAD_SIGNER_SALT)


def get_download_token_max_age() -> int:
    return int(
        getattr(
            settings,
            "ATTACHMENT_DOWNLOAD_TOKEN_MAX_AGE",
            DEFAULT_DOWNLOAD_TOKEN_MAX_AGE,
        )
    )


def build_attachment_download_token(*, attachment_id: int, company_id: int) -> str:
    signer = get_download_signer()
    payload = f"{attachment_id}:{company_id}"
    return signer.sign(payload)


def verify_attachment_download_token(*, token: str, attachment_id: int) -> int:
    signer = get_download_signer()

    try:
        unsigned = signer.unsign(token, max_age=get_download_token_max_age())
    except SignatureExpired as exc:
        raise PermissionDenied("Download link has expired.") from exc
    except BadSignature as exc:
        raise PermissionDenied("Invalid download link.") from exc

    try:
        token_attachment_id_raw, company_id_raw = unsigned.split(":", 1)
        token_attachment_id = int(token_attachment_id_raw)
        company_id = int(company_id_raw)
    except (TypeError, ValueError) as exc:
        raise PermissionDenied("Invalid download link payload.") from exc

    if token_attachment_id != int(attachment_id):
        raise PermissionDenied("Download link does not match this attachment.")

    return company_id


def company_can_access_attachment(attachment: Attachment, company_id: int) -> bool:
    if not attachment.message_id:
        return False

    message = attachment.message
    return (
        message.sender_company_id == company_id
        or message.receiver_company_id == company_id
    )


def build_attachment_download_url(*, request, attachment: Attachment, company_id=None) -> str:
    if company_id is None:
        company_id = getattr(request.user, "company_id", None)

    base_url = request.build_absolute_uri(f"/api/attachments/{attachment.id}/download/")

    if not company_id:
        return base_url

    token = build_attachment_download_token(
        attachment_id=attachment.id,
        company_id=company_id,
    )
    return f"{base_url}?{urlencode({'token': token})}"


class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = [
            "id",
            "message",
            "filename",
            "content_type",
            "size",
            "status",
            "uploaded_at",
        ]


class AttachmentViewSet(viewsets.ModelViewSet):
    """
    GET /api/attachments/                  - список (только доступные пользователю)
    GET /api/attachments/{id}/download/    - скачать файл
    DELETE /api/attachments/{id}/          - удалить (только SLAVE и только для draft)
    """

    serializer_class = AttachmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.company_id:
            return Attachment.objects.none()

        if user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can view attachment list.")

        return Attachment.objects.select_related("message").filter(
            message__sender_company_id=user.company_id
        )

    @action(detail=True, methods=["get"], permission_classes=[AllowAny])
    def download(self, request, pk=None):
        att = get_object_or_404(
            Attachment.objects.select_related("message"),
            pk=pk,
        )

        if not att.message_id:
            raise PermissionDenied("Attachment is not attached to a message.")

        has_session_access = False
        if request.user.is_authenticated and getattr(request.user, "company_id", None):
            has_session_access = company_can_access_attachment(att, request.user.company_id)

        has_token_access = False
        token = (request.query_params.get("token") or "").strip()
        if token:
            company_id = verify_attachment_download_token(
                token=token,
                attachment_id=att.id,
            )
            has_token_access = company_can_access_attachment(att, company_id)

        if not (has_session_access or has_token_access):
            raise PermissionDenied("You do not have access to this attachment.")

        body = stream_object(att.storage_key)

        if request.user.is_authenticated:
            write_audit(
                actor=request.user,
                event_type="attachment_downloaded",
                entity_type="attachment",
                entity_id=att.id,
                payload={
                    "message_id": att.message_id,
                    "filename": att.filename,
                },
            )

        response = FileResponse(
            body,
            content_type=att.content_type or "application/octet-stream",
        )
        response["Content-Disposition"] = f'attachment; filename="{att.filename}"'
        return response

    def destroy(self, request, *args, **kwargs):
        user = request.user
        att = self.get_object()

        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can delete attachments.")

        if not att.message_id:
            raise PermissionDenied("Attachment is not attached to a message.")

        msg = att.message
        if msg.sender_company_id != user.company_id:
            raise PermissionDenied("You can delete attachments only from your messages.")

        if msg.status != Message.STATUS_DRAFT:
            raise PermissionDenied("You can delete attachments only for DRAFT messages.")

        attachment_id = att.id
        message_id = att.message_id
        filename = att.filename
        storage_key = att.storage_key

        delete_object(storage_key)
        att.delete()

        write_audit(
            actor=request.user,
            event_type="attachment_deleted",
            entity_type="attachment",
            entity_id=attachment_id,
            payload={
                "message_id": message_id,
                "filename": filename,
            },
        )

        return Response(status=status.HTTP_204_NO_CONTENT)