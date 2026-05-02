from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.attachments.minio import (
    AttachmentStorageError,
    delete_object,
    upload_fileobj,
)
from apps.attachments.models import Attachment
from apps.audit.service import write_audit
from apps.common.responses import ok
from apps.companies.models import Company
from apps.messages.models import Message
from apps.messages.numbering import (
    generate_next_sender_number,
    get_next_receiver_number_suggestion,
    validate_receiver_number_format,
    register_receiver_number,
)
from apps.outbox.service import write_outbox
from apps.attachments.api import build_attachment_download_url
from apps.reconciliations.models import Reconciliation



class AttachmentStorageUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "Не удалось загрузить вложение в файловое хранилище. "
        "Проверьте настройки MinIO и его доступность."
    )
    default_code = "attachment_storage_unavailable"


class AccountDeactivated(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = {
        "code": "ACCOUNT_DEACTIVATED",
        "detail": "Вы были деактивированы от системы",
    }
    default_code = "account_deactivated"


def ensure_user_and_company_active(user):
    if not user or not user.is_authenticated:
        return

    if not user.is_active:
        raise AccountDeactivated()

    company = getattr(user, "company", None)
    if company and not company.is_active:
        raise AccountDeactivated()


class ActiveUserCompanyRequiredMixin:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        ensure_user_and_company_active(getattr(request, "user", None))


STATUS_LABELS = {
    Message.STATUS_DRAFT: "Черновик",
    Message.STATUS_PENDING: "Ожидает подтверждения",
    Message.STATUS_READ: "Прочитано",
    Message.STATUS_CONFIRMED: "Подтверждено",
}


def format_front_date(dt):
    if not dt:
        return ""
    return timezone.localtime(dt).strftime("%d.%m.%Y")


def build_attachment_payload(attachment: Attachment, request):
    download_url = build_attachment_download_url(
        request=request,
        attachment=attachment,
    )
    delete_url = request.build_absolute_uri(
        reverse("attachments-detail", args=[attachment.id])
    )
    return {
        "id": attachment.id,
        "name": attachment.filename,
        "filename": attachment.filename,
        "size": attachment.size,
        "status": attachment.status,
        "url": download_url,
        "downloadUrl": download_url,
        "deleteUrl": delete_url,
    }


def attach_uploaded_files(*, request, message: Message, files):
    uploaded_keys = []
    created_ids = []

    try:
        for file_obj in files:
            if file_obj.size > settings.MAX_ATTACHMENT_SIZE:
                raise ValidationError("File is too large.")

            content_type = getattr(file_obj, "content_type", "") or ""
            if (
                content_type
                and content_type not in settings.ALLOWED_ATTACHMENT_CONTENT_TYPES
            ):
                raise ValidationError("File type is not allowed.")

            storage_key, size = upload_fileobj(
                file_obj,
                content_type=content_type,
                filename=file_obj.name,
            )
            uploaded_keys.append(storage_key)

            attachment = Attachment.objects.create(
                message=message,
                storage_key=storage_key,
                filename=file_obj.name,
                content_type=content_type,
                size=size,
                status=Attachment.STATUS_ATTACHED,
            )
            created_ids.append(attachment.id)

            write_audit(
                actor=request.user,
                event_type="attachment_attached",
                entity_type="attachment",
                entity_id=attachment.id,
                payload={
                    "message_id": message.id,
                    "filename": attachment.filename,
                    "size": attachment.size,
                    "content_type": attachment.content_type,
                },
            )
            write_outbox(
                event_type="attachment_attached",
                payload={"attachment_id": attachment.id, "message_id": message.id},
            )
    except Exception as exc:
        for storage_key in uploaded_keys:
            try:
                delete_object(storage_key)
            except Exception:
                pass
        if created_ids:
            Attachment.objects.filter(id__in=created_ids).delete()
        if isinstance(exc, AttachmentStorageError):
            raise AttachmentStorageUnavailable() from exc
        raise


def get_current_company_with_master(user):
    if not user.company_id:
        return None

    company = (
        Company.objects.select_related("master_partner")
        .filter(pk=user.company_id)
        .first()
    )
    if company is None:
        return None

    if company.company_type != Company.TYPE_SLAVE:
        return company

    if company.master_partner_id:
        return company

    masters = list(
        Company.objects.filter(
            company_type=Company.TYPE_MASTER,
            is_active=True,
        ).order_by("id")[:2]
    )

    if len(masters) == 1:
        company.master_partner = masters[0]
        company.save(update_fields=["master_partner"])

        company = (
            Company.objects.select_related("master_partner")
            .filter(pk=company.pk)
            .first()
        )

    return company


def resolve_late_send_reconciliation(*, user, master_company, reconciliation_id):
    if reconciliation_id in (None, "", "null"):
        return None

    try:
        reconciliation_id = int(reconciliation_id)
    except (TypeError, ValueError):
        raise ValidationError("reconciliation_id must be an integer.")

    reconciliation = Reconciliation.objects.filter(
        id=reconciliation_id,
        status=Reconciliation.STATUS_ACTIVE,
        master_company=master_company,
        slave_company=user.company,
    ).first()

    if reconciliation is None:
        raise ValidationError(
            "Active reconciliation for this pair of companies was not found."
        )

    return reconciliation


class FrontendMessageSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    statusCode = serializers.CharField(source="status", read_only=True)
    company = serializers.SerializerMethodField()
    senderCompany = serializers.CharField(source="sender_company.name", read_only=True)
    recipientCompany = serializers.CharField(source="receiver_company.name", read_only=True)
    text = serializers.CharField(source="body", allow_blank=True, required=False)
    html = serializers.CharField(source="body_html", allow_blank=True, required=False)
    date = serializers.SerializerMethodField()
    sentAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    readAt = serializers.DateTimeField(source="read_at", read_only=True)
    confirmedAt = serializers.DateTimeField(source="confirmed_at", read_only=True)
    statusChangedAt = serializers.SerializerMethodField()
    number = serializers.SerializerMethodField()
    outgoingNumber = serializers.CharField(source="sender_number", read_only=True)
    incomingNumber = serializers.CharField(source="receiver_number", read_only=True)
    attachments = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "status",
            "statusCode",
            "company",
            "senderCompany",
            "recipientCompany",
            "subject",
            "text",
            "html",
            "date",
            "sentAt",
            "updatedAt",
            "readAt",
            "confirmedAt",
            "statusChangedAt",
            "number",
            "outgoingNumber",
            "incomingNumber",
            "attachments",
        ]
        read_only_fields = [
            "id",
            "status",
            "statusCode",
            "company",
            "senderCompany",
            "recipientCompany",
            "date",
            "sentAt",
            "updatedAt",
            "readAt",
            "confirmedAt",
            "statusChangedAt",
            "number",
            "outgoingNumber",
            "incomingNumber",
            "attachments",
        ]
        extra_kwargs = {
            "subject": {"required": False, "allow_blank": True},
        }

    def get_status(self, obj):
        return STATUS_LABELS.get(obj.status, obj.status)

    def get_date(self, obj):
        return format_front_date(obj.created_at)

    def get_statusChangedAt(self, obj):
        value = obj.confirmed_at or obj.read_at or obj.updated_at
        return value.isoformat() if value else None

    def get_attachments(self, obj):
        request = self.context.get("request")
        if request is None:
            return []
        return [build_attachment_payload(att, request) for att in obj.attachments.all()]

    def get_company(self, obj):
        return ""

    def get_number(self, obj):
        return ""


class DraftSerializer(FrontendMessageSerializer):
    def get_company(self, obj):
        return obj.sender_company.name if obj.sender_company_id else ""

    def get_number(self, obj):
        return obj.sender_number or ""


class InboxSerializer(FrontendMessageSerializer):
    def get_company(self, obj):
        return obj.sender_company.name if obj.sender_company_id else ""

    def get_number(self, obj):
        return obj.receiver_number or ""


class SentSerializer(FrontendMessageSerializer):
    def get_company(self, obj):
        return obj.receiver_company.name if obj.receiver_company_id else ""

    def get_number(self, obj):
        return obj.sender_number or ""


class InboxConfirmSerializer(serializers.Serializer):
    receiver_number = serializers.CharField(max_length=16)


class MessageComposeMetaView(ActiveUserCompanyRequiredMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        company = get_current_company_with_master(request.user)

        recipient_company_name = ""
        recipient_company_id = None

        if company and company.company_type == Company.TYPE_SLAVE:
            if not company.master_partner_id:
                raise PermissionDenied("Slave company has no master_partner configured.")

            recipient_company_name = company.master_partner.name
            recipient_company_id = company.master_partner.id

        return ok(
            {
                "recipientCompanyName": recipient_company_name,
                "recipientCompanyId": recipient_company_id,
            }
        )


class MessageSummaryView(ActiveUserCompanyRequiredMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        inbox = sent = drafts = 0
        inbox_unconfirmed = 0
        sent_unconfirmed = 0

        if user.company_id:
            if user.company.company_type == "master":
                inbox_queryset = Message.objects.filter(
                receiver_company_id=user.company_id,
                is_deleted=False,
                ).exclude(status=Message.STATUS_DRAFT)
                inbox = inbox_queryset.count()
                inbox_unconfirmed = inbox_queryset.filter(
                    status__in=[Message.STATUS_PENDING, Message.STATUS_READ]
                ).count()
            elif user.company.company_type == "slave":
                sent_queryset = Message.objects.filter(
                    sender_company_id=user.company_id,
                    is_deleted=False,
                )
                drafts = sent_queryset.filter(status=Message.STATUS_DRAFT).count()
                sent = sent_queryset.exclude(status=Message.STATUS_DRAFT).count()
                sent_unconfirmed = sent_queryset.filter(
                    status__in=[Message.STATUS_PENDING, Message.STATUS_READ]
                ).count()

        return ok(
            {
                "inbox": inbox,
                "sent": sent,
                "drafts": drafts,
                "inboxCount": inbox,
                "sentCount": sent,
                "draftsCount": drafts,
                "inboxUnconfirmed": inbox_unconfirmed,
                "sentUnconfirmed": sent_unconfirmed,
            }
        )


class MessageDraftViewSet(ActiveUserCompanyRequiredMixin, viewsets.ModelViewSet):
    serializer_class = DraftSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        user = self.request.user
        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can access drafts.")
        return (
            Message.objects.select_related("sender_company", "receiver_company")
            .prefetch_related("attachments")
            .filter(
                sender_company=user.company,
                status=Message.STATUS_DRAFT,
                is_deleted=False,
            )
            .order_by("-created_at")
        )

    def create(self, request, *args, **kwargs):
        user = request.user
        company = get_current_company_with_master(user)

        if not company or company.company_type != "slave":
            raise PermissionDenied("Only SLAVE company can create drafts.")

        master = company.master_partner
        if not master:
            raise PermissionDenied("Slave company has no master_partner configured.")

        subject = str(request.data.get("subject") or "")
        body = str(request.data.get("text") or request.data.get("body") or "")
        body_html = str(
            request.data.get("html") or request.data.get("body_html") or ""
        )
        files = request.FILES.getlist("files") or request.FILES.getlist("file")

        reconciliation_id = request.data.get("reconciliation_id")
        late_send_reconciliation = resolve_late_send_reconciliation(
            user=user,
            master_company=master,
            reconciliation_id=reconciliation_id,
        )

        with transaction.atomic():
            message = Message.objects.create(
                sender_company=company,
                receiver_company=master,
                late_send_reconciliation=late_send_reconciliation,
                created_by=request.user,
                status=Message.STATUS_DRAFT,
                subject=subject,
                body=body,
                body_html=body_html,
            )

            if files:
                attach_uploaded_files(request=request, message=message, files=files)

            write_audit(
                actor=user,
                event_type="message_draft_created",
                entity_type="message",
                entity_id=message.id,
                old_values={},
                new_values={
                    "status": message.status,
                    "sender_company_id": message.sender_company_id,
                    "receiver_company_id": message.receiver_company_id,
                    "subject": message.subject,
                    "created_by_id": message.created_by_id,
                    "created_by_username": request.user.username,
                },
                reason="draft created by user",
                request=request,
            )
            write_outbox(
                event_type="message_draft_created",
                payload={"message_id": message.id},
            )

        serializer = self.get_serializer(message, context={"request": request})
        return ok(serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        draft = self.get_object()
        user = request.user

        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE company can edit drafts.")
        if draft.sender_company_id != user.company_id or draft.status != Message.STATUS_DRAFT:
            raise PermissionDenied("You can edit only your own drafts.")

        changed = False
        subject = request.data.get("subject")
        body = request.data.get("text")
        body_html = request.data.get("html")
        old_values = {
            "subject": draft.subject,
            "body": draft.body,
            "body_html": draft.body_html,
        }

        if subject is not None:
            draft.subject = str(subject)
            changed = True
        if body is not None:
            draft.body = str(body)
            changed = True
        if body_html is not None:
            draft.body_html = str(body_html)
            changed = True

        should_write_audit = request.data.get("audit") is True

        if changed:
            new_values = {
                "subject": draft.subject,
                "body": draft.body,
                "body_html": draft.body_html,
            }

            if old_values != new_values:
                draft.save(update_fields=["subject", "body", "body_html", "updated_at"])

                if should_write_audit:
                    write_audit(
                        actor=request.user,
                        event_type="message_draft_updated",
                        entity_type="message",
                        entity_id=draft.id,
                        old_values=old_values,
                        new_values=new_values,
                        reason="draft explicitly saved by user",
                        request=request,
                    )

        serializer = self.get_serializer(draft, context={"request": request})
        return ok(serializer.data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        draft = self.get_object()
        user = request.user

        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE company can delete drafts.")
        if draft.sender_company_id != user.company_id or draft.status != Message.STATUS_DRAFT:
            raise PermissionDenied("You can delete only your own drafts.")

        with transaction.atomic():
            old_values = {
                "status": draft.status,
                "subject": draft.subject,
                "body": draft.body,
                "body_html": draft.body_html,
                "is_deleted": draft.is_deleted,
            }

            draft.is_deleted = True
            draft.deleted_at = timezone.now()
            draft.deleted_by = request.user
            draft.delete_reason = "draft deleted by user"
            draft.save(
                update_fields=[
                    "is_deleted",
                    "deleted_at",
                    "deleted_by",
                    "delete_reason",
                    "updated_at",
                ]
            )

            write_audit(
                actor=request.user,
                event_type="message_draft_deleted",
                entity_type="message",
                entity_id=draft.id,
                old_values=old_values,
                new_values={
                    "is_deleted": draft.is_deleted,
                    "deleted_at": draft.deleted_at.isoformat() if draft.deleted_at else None,
                    "deleted_by": request.user.username,
                    "delete_reason": draft.delete_reason,
                },
                reason="draft deleted by user",
                request=request,
            )

        return ok(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        user = request.user
        draft = self.get_object()

        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can send drafts.")
        if draft.sender_company_id != user.company_id or draft.status != Message.STATUS_DRAFT:
            raise PermissionDenied("You can send only your own drafts.")

        with transaction.atomic():
            old_values = {
                "status": draft.status,
                "sender_number": draft.sender_number,
                "created_by_id": draft.created_by_id,
            }

            if not draft.sender_number:
                draft.sender_number = generate_next_sender_number(user.company)

            if not draft.created_by_id:
                draft.created_by = request.user

            draft.status = Message.STATUS_PENDING
            draft.save(
                update_fields=[
                    "sender_number",
                    "created_by",
                    "status",
                    "updated_at",
                ]
            )

            write_audit(
                actor=request.user,
                event_type="message_sent",
                entity_type="message",
                entity_id=draft.id,
                old_values=old_values,
                new_values={
                    "status": draft.status,
                    "sender_number": draft.sender_number,
                    "created_by_id": draft.created_by_id,
                    "sender_company_id": draft.sender_company_id,
                    "receiver_company_id": draft.receiver_company_id,
                },
                reason="draft sent as message",
                request=request,
            )
            write_outbox(
                event_type="message_sent",
                payload={"message_id": draft.id},
            )

        serializer = SentSerializer(draft, context={"request": request})
        return ok(serializer.data)

    @action(
        detail=True,
        methods=["post"],
        url_path="attachments",
        parser_classes=[MultiPartParser, FormParser],
    )
    def add_attachment(self, request, pk=None):
        user = request.user
        draft = self.get_object()

        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can attach files.")
        if draft.sender_company_id != user.company_id or draft.status != Message.STATUS_DRAFT:
            raise PermissionDenied("You can attach files only to your own drafts.")

        files = request.FILES.getlist("files") or request.FILES.getlist("file")
        if not files:
            raise ValidationError("File is required.")

        with transaction.atomic():
            attach_uploaded_files(request=request, message=draft, files=files)

        serializer = self.get_serializer(draft, context={"request": request})
        return ok(serializer.data, status=status.HTTP_201_CREATED)


class InboxViewSet(ActiveUserCompanyRequiredMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = InboxSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.company or user.company.company_type != "master":
            raise PermissionDenied("Only MASTER can view inbox messages.")

        queryset = (
            Message.objects.select_related("sender_company", "receiver_company")
            .prefetch_related("attachments")
            .filter(receiver_company=user.company, is_deleted=False)
            .exclude(status=Message.STATUS_DRAFT)
            .order_by("-created_at")
        )

        company = (self.request.query_params.get("company") or "").strip()
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        status_group = (self.request.query_params.get("status_group") or "").strip()
        search = (self.request.query_params.get("search") or "").strip()

        if company:
            if company.isdigit():
                queryset = queryset.filter(sender_company_id=int(company))
            else:
                queryset = queryset.filter(sender_company__name__iexact=company)

        if date_from:
            parsed_date_from = parse_date(date_from)
            if not parsed_date_from:
                raise ValidationError("date_from must be in YYYY-MM-DD format.")
            queryset = queryset.filter(created_at__date__gte=parsed_date_from)

        if date_to:
            parsed_date_to = parse_date(date_to)
            if not parsed_date_to:
                raise ValidationError("date_to must be in YYYY-MM-DD format.")
            queryset = queryset.filter(created_at__date__lte=parsed_date_to)

        if status_group:
            if status_group == "confirmed":
                queryset = queryset.filter(status=Message.STATUS_CONFIRMED)
            elif status_group == "unconfirmed":
                queryset = queryset.filter(
                    status__in=[Message.STATUS_PENDING, Message.STATUS_READ]
                )
            elif status_group == "read":
                queryset = queryset.filter(status=Message.STATUS_READ)
            elif status_group == "pending":
                queryset = queryset.filter(status=Message.STATUS_PENDING)
            elif status_group in {"all", "unread_unconfirmed", "read_unconfirmed"}:
                if status_group == "unread_unconfirmed":
                    queryset = queryset.filter(status=Message.STATUS_PENDING)
                elif status_group == "read_unconfirmed":
                    queryset = queryset.filter(status=Message.STATUS_READ)
            else:
                raise ValidationError("Unsupported status_group value.")

        if search:
            queryset = queryset.filter(
                Q(subject__icontains=search)
                | Q(body__icontains=search)
                | Q(sender_company__name__icontains=search)
                | Q(sender_number__icontains=search)
                | Q(receiver_number__icontains=search)
            )

        return queryset

    @action(detail=True, methods=["post"])
    def open(self, request, pk=None):
        user = request.user
        message = self.get_object()
        if user.company.company_type != "master":
            raise PermissionDenied("Only MASTER can open inbox messages.")

        with transaction.atomic():
            if message.status == Message.STATUS_PENDING:
                old_values = {
                    "status": message.status,
                    "read_at": message.read_at.isoformat() if message.read_at else None,
                }
                message.status = Message.STATUS_READ
                message.read_at = timezone.now()
                message.save(update_fields=["status", "read_at", "updated_at"])

                write_audit(
                    actor=request.user,
                    event_type="message_opened",
                    entity_type="message",
                    entity_id=message.id,
                    old_values=old_values,
                    new_values={
                        "status": message.status,
                        "read_at": message.read_at.isoformat() if message.read_at else None,
                    },
                    reason="message opened by receiver",
                    request=request,
                )
                write_outbox(
                    event_type="message_opened",
                    payload={"message_id": message.id},
                )

        serializer = self.get_serializer(message, context={"request": request})
        return ok(serializer.data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        user = request.user
        message = self.get_object()
        if user.company.company_type != "master":
            raise PermissionDenied("Only MASTER can confirm inbox messages.")

        if message.status not in {Message.STATUS_PENDING, Message.STATUS_READ}:
            raise PermissionDenied("Only unconfirmed messages can be confirmed.")

        serializer = InboxConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        receiver_number = serializer.validated_data["receiver_number"].strip().upper()

        if not validate_receiver_number_format(receiver_number):
            raise ValidationError("receiver_number must match format I-000001.")

        number_is_taken = Message.objects.filter(
            receiver_company=user.company,
            receiver_number=receiver_number,
        ).exclude(id=message.id).exists()
        if number_is_taken:
            raise ValidationError("receiver_number is already taken.")

        with transaction.atomic():
            old_values = {
                "status": message.status,
                "receiver_number": message.receiver_number,
                "read_at": message.read_at.isoformat() if message.read_at else None,
                "confirmed_at": message.confirmed_at.isoformat() if message.confirmed_at else None,
                "confirmed_by_id": message.confirmed_by_id,
            }
            register_receiver_number(user.company, receiver_number)

            if message.status == Message.STATUS_PENDING and message.read_at is None:
                message.read_at = timezone.now()

            message.status = Message.STATUS_CONFIRMED
            message.receiver_number = receiver_number
            message.confirmed_at = timezone.now()
            message.confirmed_by = request.user
            message.save(
                update_fields=[
                    "status",
                    "receiver_number",
                    "read_at",
                    "confirmed_at",
                    "confirmed_by",
                    "updated_at",
                ]
            )

            write_audit(
                actor=request.user,
                event_type="message_confirmed",
                entity_type="message",
                entity_id=message.id,
                old_values=old_values,
                new_values={
                    "status": message.status,
                    "receiver_number": message.receiver_number,
                    "read_at": message.read_at.isoformat() if message.read_at else None,
                    "confirmed_at": message.confirmed_at.isoformat() if message.confirmed_at else None,
                    "confirmed_by_id": message.confirmed_by_id,
                    "confirmed_by_username": request.user.username,
                },
                reason="message confirmed by receiver",
                request=request,
            )
            write_outbox(
                event_type="message_confirmed",
                payload={"message_id": message.id},
            )

        serializer = self.get_serializer(message, context={"request": request})
        return ok(serializer.data)

    @action(detail=True, methods=["get"], url_path="suggest-receiver-number")
    def suggest_receiver_number(self, request, pk=None):
        user = request.user
        message = self.get_object()

        if user.company.company_type != "master":
            raise PermissionDenied("Only MASTER can request receiver number suggestion.")
        if message.receiver_company_id != user.company_id:
            raise PermissionDenied("You do not have access to this message.")

        return ok(
            {
                "suggested_receiver_number": get_next_receiver_number_suggestion(
                    user.company
                )
            }
        )


class SentViewSet(ActiveUserCompanyRequiredMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = SentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        user = self.request.user
        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can view sent messages.")

        queryset = (
            Message.objects.select_related("sender_company", "receiver_company")
            .prefetch_related("attachments")
            .filter(sender_company=user.company, is_deleted=False)
            .exclude(status=Message.STATUS_DRAFT)
            .order_by("-created_at")
        )

        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        status_group = (self.request.query_params.get("status_group") or "").strip()
        search = (self.request.query_params.get("search") or "").strip()

        if date_from:
            parsed_date_from = parse_date(date_from)
            if not parsed_date_from:
                raise ValidationError("date_from must be in YYYY-MM-DD format.")
            queryset = queryset.filter(created_at__date__gte=parsed_date_from)

        if date_to:
            parsed_date_to = parse_date(date_to)
            if not parsed_date_to:
                raise ValidationError("date_to must be in YYYY-MM-DD format.")
            queryset = queryset.filter(created_at__date__lte=parsed_date_to)

        if status_group:
            if status_group == "confirmed":
                queryset = queryset.filter(status=Message.STATUS_CONFIRMED)
            elif status_group == "unconfirmed":
                queryset = queryset.filter(
                    status__in=[Message.STATUS_PENDING, Message.STATUS_READ]
                )
            elif status_group == "pending":
                queryset = queryset.filter(status=Message.STATUS_PENDING)
            elif status_group == "read":
                queryset = queryset.filter(status=Message.STATUS_READ)
            elif status_group != "all":
                raise ValidationError("Unsupported status_group value.")

        if search:
            queryset = queryset.filter(
                Q(subject__icontains=search)
                | Q(body__icontains=search)
                | Q(sender_number__icontains=search)
                | Q(receiver_number__icontains=search)
                | Q(receiver_company__name__icontains=search)
            )

        return queryset

    @action(detail=False, methods=["post"], url_path="compose")
    def compose(self, request):
        user = request.user
        company = get_current_company_with_master(user)

        if not company or company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can send messages.")

        master = company.master_partner
        if not master:
            raise PermissionDenied("Slave company has no master_partner configured.")

        subject = str(request.data.get("subject") or "")
        body = str(request.data.get("text") or request.data.get("body") or "")
        body_html = str(
            request.data.get("html") or request.data.get("body_html") or ""
        )
        files = request.FILES.getlist("files") or request.FILES.getlist("file")

        reconciliation_id = request.data.get("reconciliation_id")
        late_send_reconciliation = resolve_late_send_reconciliation(
            user=user,
            master_company=master,
            reconciliation_id=reconciliation_id,
        )

        with transaction.atomic():
            message = Message.objects.create(
                sender_company=company,
                receiver_company=master,
                late_send_reconciliation=late_send_reconciliation,
                created_by=request.user,
                sender_number=generate_next_sender_number(company),
                status=Message.STATUS_PENDING,
                subject=subject,
                body=body,
                body_html=body_html,
            )

            if files:
                attach_uploaded_files(request=request, message=message, files=files)

            write_audit(
                actor=request.user,
                event_type="message_sent",
                entity_type="message",
                entity_id=message.id,
                payload={
                    "new_status": message.status,
                    "sender_company_id": message.sender_company_id,
                    "receiver_company_id": message.receiver_company_id,
                },
            )
            write_outbox(
                event_type="message_sent",
                payload={"message_id": message.id},
            )

        serializer = self.get_serializer(message, context={"request": request})
        return ok(serializer.data, status=status.HTTP_201_CREATED)
