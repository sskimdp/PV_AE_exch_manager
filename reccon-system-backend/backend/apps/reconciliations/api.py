from io import BytesIO

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.db.models import Prefetch, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiExample, extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.companies.models import Company
from apps.messages.models import Message
from apps.audit.service import write_audit
from apps.reconciliations.export import build_reconciliation_export_workbook
from apps.reconciliations.models import (
    Reconciliation,
    ReconciliationChatMessage,
    ReconciliationStage,
    ReconciliationStageItem,
)
from apps.reconciliations.services import (
    create_next_stage,
    create_reconciliation_with_first_stage,
    finish_reconciliation,
)


class CompanyMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ["id", "name", "company_type"]


class ReconciliationStageItemSerializer(serializers.ModelSerializer):
    available_for_slave_confirmation = serializers.SerializerMethodField()
    stage_reviewed = serializers.BooleanField(source="confirmed_by_slave", read_only=True)
    message_id = serializers.IntegerField(read_only=True)

    number = serializers.SerializerMethodField()
    outgoing_number = serializers.SerializerMethodField()
    incoming_number = serializers.SerializerMethodField()
    subject = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    sent_at = serializers.SerializerMethodField()
    read_at = serializers.SerializerMethodField()
    confirmed_at = serializers.SerializerMethodField()
    sender_company_name = serializers.SerializerMethodField()
    recipient_company_name = serializers.SerializerMethodField()
    sender_login = serializers.SerializerMethodField()
    confirmer_login = serializers.SerializerMethodField()

    class Meta:
        model = ReconciliationStageItem
        fields = [
            "id",
            "message",
            "message_id",
            "subject_snapshot",
            "status_snapshot",
            "sent_at_snapshot",
            "confirmed_at_snapshot",
            "confirmed_by_slave",
            "confirmed_by_slave_at",
            "created_at",
            "available_for_slave_confirmation",
            "stage_reviewed",
            "number",
            "outgoing_number",
            "incoming_number",
            "subject",
            "status",
            "sent_at",
            "read_at",
            "confirmed_at",
            "sender_company_name",
            "recipient_company_name",
            "sender_login",
            "confirmer_login",
        ]
        read_only_fields = fields

    def get_available_for_slave_confirmation(self, obj):
        return not obj.confirmed_by_slave

    def _message(self, obj):
        return getattr(obj, "message", None)

    def _snapshot_status(self, obj):
        return obj.status_snapshot or ""

    def get_number(self, obj):
        message = self._message(obj)
        if not message:
            return ""

        if self._snapshot_status(obj) == Message.STATUS_CONFIRMED:
            return getattr(message, "receiver_number", "") or ""

        return getattr(message, "sender_number", "") or ""

    def get_outgoing_number(self, obj):
        message = self._message(obj)
        return getattr(message, "sender_number", "") or ""

    def get_incoming_number(self, obj):
        message = self._message(obj)
        if self._snapshot_status(obj) == Message.STATUS_CONFIRMED:
            return getattr(message, "receiver_number", "") or ""
        return ""

    def get_subject(self, obj):
        message = self._message(obj)
        return obj.subject_snapshot or getattr(message, "subject", "") or ""

    def get_status(self, obj):
        message = self._message(obj)
        return obj.status_snapshot or getattr(message, "status", "") or ""

    def get_sent_at(self, obj):
        message = self._message(obj)
        return obj.sent_at_snapshot or getattr(message, "created_at", None)

    def get_read_at(self, obj):
        message = self._message(obj)
        snapshot_status = self._snapshot_status(obj)

        if snapshot_status in {Message.STATUS_READ, Message.STATUS_CONFIRMED}:
            return getattr(message, "read_at", None)

        return None

    def get_confirmed_at(self, obj):
        return obj.confirmed_at_snapshot

    def get_sender_company_name(self, obj):
        message = self._message(obj)
        sender_company = getattr(message, "sender_company", None)
        return getattr(sender_company, "name", "") or ""

    def get_recipient_company_name(self, obj):
        message = self._message(obj)
        receiver_company = getattr(message, "receiver_company", None)
        if receiver_company:
            return getattr(receiver_company, "name", "") or ""

        recipient_company = getattr(message, "recipient_company", None)
        if recipient_company:
            return getattr(recipient_company, "name", "") or ""

        return ""

    def get_sender_login(self, obj):
        message = self._message(obj)
        created_by = getattr(message, "created_by", None)
        if created_by:
            return getattr(created_by, "username", "") or ""
        author = getattr(message, "author", None)
        if author:
            return getattr(author, "username", "") or ""
        return ""

    def get_confirmer_login(self, obj):
        message = self._message(obj)
        confirmed_by = getattr(message, "confirmed_by", None)
        if confirmed_by:
            return getattr(confirmed_by, "username", "") or ""
        return ""


class ReconciliationStageSummarySerializer(serializers.ModelSerializer):
    items_count = serializers.SerializerMethodField()
    confirmed_items_count = serializers.SerializerMethodField()
    all_items_confirmed_by_slave = serializers.ReadOnlyField()

    class Meta:
        model = ReconciliationStage
        fields = [
            "id",
            "stage_number",
            "status",
            "items_count",
            "confirmed_items_count",
            "all_items_confirmed_by_slave",
            "created_at",
            "finished_at",
        ]
        read_only_fields = fields

    def get_items_count(self, obj):
        return obj.items.count()

    def get_confirmed_items_count(self, obj):
        return obj.items.filter(confirmed_by_slave=True).count()


class ReconciliationStageDetailSerializer(serializers.ModelSerializer):
    items = ReconciliationStageItemSerializer(many=True, read_only=True)
    items_count = serializers.SerializerMethodField()
    confirmed_items_count = serializers.SerializerMethodField()
    all_items_confirmed_by_slave = serializers.ReadOnlyField()
    is_completed = serializers.SerializerMethodField()

    class Meta:
        model = ReconciliationStage
        fields = [
            "id",
            "stage_number",
            "status",
            "items_count",
            "confirmed_items_count",
            "all_items_confirmed_by_slave",
            "created_at",
            "finished_at",
            "is_completed",
            "items",
        ]
        read_only_fields = fields

    def get_items_count(self, obj):
        return obj.items.count()

    def get_confirmed_items_count(self, obj):
        return obj.items.filter(confirmed_by_slave=True).count()

    def get_is_completed(self, obj):
        return obj.status == ReconciliationStage.STATUS_FINISHED


class ReconciliationListSerializer(serializers.ModelSerializer):
    master_company = CompanyMiniSerializer(read_only=True)
    slave_company = CompanyMiniSerializer(read_only=True)
    current_stage_number = serializers.ReadOnlyField()
    stages_count = serializers.SerializerMethodField()

    class Meta:
        model = Reconciliation
        fields = [
            "id",
            "master_company",
            "slave_company",
            "period_start",
            "period_end",
            "status",
            "current_stage_number",
            "stages_count",
            "created_at",
            "finished_at",
        ]
        read_only_fields = fields

    def get_stages_count(self, obj):
        return obj.stages.count()


class ReconciliationDetailSerializer(serializers.ModelSerializer):
    master_company = CompanyMiniSerializer(read_only=True)
    slave_company = CompanyMiniSerializer(read_only=True)
    current_stage_number = serializers.ReadOnlyField()
    stages = serializers.SerializerMethodField()
    current_stage = serializers.SerializerMethodField()

    class Meta:
        model = Reconciliation
        fields = [
            "id",
            "master_company",
            "slave_company",
            "period_start",
            "period_end",
            "status",
            "current_stage_number",
            "created_at",
            "finished_at",
            "stages",
            "current_stage",
        ]
        read_only_fields = fields

    def get_stages(self, obj):
        stages = obj.stages.all().order_by("stage_number")
        return ReconciliationStageDetailSerializer(stages, many=True).data

    def get_current_stage(self, obj):
        stage = obj.current_stage
        if not stage:
            return None
        return ReconciliationStageDetailSerializer(stage).data


class ReconciliationCreateSerializer(serializers.Serializer):
    slave_company = serializers.PrimaryKeyRelatedField(
        queryset=Company.objects.filter(company_type="slave")
    )
    period_start = serializers.DateField()
    period_end = serializers.DateField()

    def create(self, validated_data):
        request = self.context["request"]
        user = request.user

        if not user.company or user.company.company_type != "master":
            raise PermissionDenied("Only MASTER can create reconciliations.")

        try:
            rec = create_reconciliation_with_first_stage(
                created_by=user,
                master_company=user.company,
                slave_company=validated_data["slave_company"],
                period_start=validated_data["period_start"],
                period_end=validated_data["period_end"],
            )
        except DjangoValidationError as exc:
            message = exc.messages if hasattr(exc, "messages") else str(exc)
            raise ValidationError(message)

        write_audit(
            actor=user,
            event_type="reconciliation_created",
            entity_type="reconciliation",
            entity_id=rec.id,
            old_values={},
            new_values={
                "id": rec.id,
                "master_company_id": rec.master_company_id,
                "slave_company_id": rec.slave_company_id,
                "period_start": rec.period_start.isoformat() if rec.period_start else None,
                "period_end": rec.period_end.isoformat() if rec.period_end else None,
                "status": rec.status,
                "current_stage_number": rec.current_stage_number,
            },
            reason="reconciliation created by master",
            request=request,
        )

        return rec

    def to_representation(self, instance):
        return ReconciliationDetailSerializer(instance).data


class ReconciliationBulkConfirmSerializer(serializers.Serializer):
    item_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=True,
        required=False,
        default=list,
    )


class ReconciliationChatMessageSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source="author.username", read_only=True)
    company = CompanyMiniSerializer(read_only=True)

    class Meta:
        model = ReconciliationChatMessage
        fields = [
            "id",
            "text",
            "created_at",
            "stage_number",
            "author",
            "author_username",
            "company",
        ]
        read_only_fields = fields


class ReconciliationChatCreateSerializer(serializers.Serializer):
    text = serializers.CharField()
    stage_number = serializers.IntegerField(min_value=1, required=False)


class ReconciliationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        if not user.company_id:
            return Reconciliation.objects.none()

        item_qs = (
            ReconciliationStageItem.objects.select_related(
                "message",
                "message__sender_company",
                "message__receiver_company",
            )
            .order_by("id")
        )

        return (
            Reconciliation.objects.select_related(
                "master_company",
                "slave_company",
                "created_by",
            )
            .prefetch_related(
                Prefetch("stages__items", queryset=item_qs),
                "chat_messages__author",
                "chat_messages__company",
            )
            .filter(
                Q(master_company_id=user.company_id) | Q(slave_company_id=user.company_id)
            )
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        if self.action == "create":
            return ReconciliationCreateSerializer
        if self.action == "retrieve":
            return ReconciliationDetailSerializer
        return ReconciliationListSerializer

    @extend_schema(
        request=ReconciliationBulkConfirmSerializer,
        responses={200: None},
    )
    @action(detail=True, methods=["post"], url_path="bulk-confirm")
    def bulk_confirm(self, request, pk=None):
        reconciliation = self.get_object()
        user = request.user

        if not user.company or user.company.company_type != "slave":
            raise PermissionDenied("Only SLAVE can confirm reconciliation items.")

        if user.company_id != reconciliation.slave_company_id:
            raise PermissionDenied("You can confirm only reconciliations of your company.")

        if reconciliation.status != Reconciliation.STATUS_ACTIVE:
            raise ValidationError("Only active reconciliations can be confirmed.")

        stage = reconciliation.current_stage
        if not stage:
            raise ValidationError("There is no active stage for this reconciliation.")

        serializer = ReconciliationBulkConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        item_ids = serializer.validated_data.get("item_ids", [])
        stage_items_qs = stage.items.all()

        if not stage_items_qs.exists():
            if item_ids:
                raise ValidationError("Empty stage cannot include item_ids.")

            return Response(
                {
                    "ok": True,
                    "data": {
                        "stage_id": stage.id,
                        "confirmed_count": 0,
                        "all_items_confirmed_by_slave": True,
                    },
                }
            )

        if not item_ids:
            raise ValidationError("Выберите хотя бы одно сообщение для подтверждения.")

        items = list(stage_items_qs.filter(id__in=item_ids))

        if len(items) != len(item_ids):
            raise ValidationError("Some item_ids do not belong to the current stage.")

        now = timezone.now()

        old_values = {
            "stage_id": stage.id,
            "stage_number": stage.stage_number,
            "item_ids": item_ids,
            "confirmed_before": [
                {
                    "id": item.id,
                    "confirmed_by_slave": item.confirmed_by_slave,
                    "confirmed_by_slave_at": (
                        item.confirmed_by_slave_at.isoformat()
                        if item.confirmed_by_slave_at
                        else None
                    ),
                }
                for item in items
            ],
        }

        with transaction.atomic():
            for item in items:
                item.confirmed_by_slave = True
                item.confirmed_by_slave_at = now

            ReconciliationStageItem.objects.bulk_update(
                items,
                ["confirmed_by_slave", "confirmed_by_slave_at"],
            )

            write_audit(
                actor=request.user,
                event_type="reconciliation_items_confirmed_by_slave",
                entity_type="reconciliation",
                entity_id=reconciliation.id,
                old_values=old_values,
                new_values={
                    "stage_id": stage.id,
                    "stage_number": stage.stage_number,
                    "confirmed_count": len(items),
                    "item_ids": item_ids,
                    "confirmed_by_slave_at": now.isoformat(),
                },
                reason="slave confirmed reconciliation stage items",
                request=request,
            )

        return Response(
            {
                "ok": True,
                "data": {
                    "stage_id": stage.id,
                    "confirmed_count": len(items),
                    "all_items_confirmed_by_slave": stage.items.filter(
                        confirmed_by_slave=False
                    )
                    .exclude(id__in=item_ids)
                    .count()
                    == 0,
                },
            }
        )

    @extend_schema(
        request=ReconciliationChatCreateSerializer,
        responses={
            200: ReconciliationChatMessageSerializer(many=True),
            201: ReconciliationChatMessageSerializer,
        },
        examples=[
            OpenApiExample(
                "Send chat message",
                value={
                    "text": "Здравствуйте, проверьте, пожалуйста, сообщения текущего этапа.",
                    "stage_number": 1,
                },
                request_only=True,
            )
        ],
    )
    @action(detail=True, methods=["get", "post"], url_path="chat")
    def chat(self, request, pk=None):
        reconciliation = self.get_object()
        user = request.user

        if not user.company_id:
            raise PermissionDenied("User must belong to a company.")

        if user.company_id not in {
            reconciliation.master_company_id,
            reconciliation.slave_company_id,
        }:
            raise PermissionDenied("You do not have access to this reconciliation chat.")

        if request.method == "GET":
            messages = reconciliation.chat_messages.select_related("author", "company").all()
            serializer = ReconciliationChatMessageSerializer(messages, many=True)
            return Response(
                {
                    "ok": True,
                    "data": serializer.data,
                }
            )

        serializer = ReconciliationChatCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        text = serializer.validated_data["text"].strip()
        if not text:
            raise ValidationError("Message text cannot be empty.")

        current_stage_number = reconciliation.current_stage_number or 1
        stage_number = serializer.validated_data.get("stage_number") or current_stage_number

        if stage_number < 1:
            raise ValidationError("stage_number must be greater than or equal to 1.")

        if stage_number > reconciliation.current_stage_number:
            raise ValidationError("stage_number cannot be greater than current stage number.")

        chat_message = ReconciliationChatMessage.objects.create(
            reconciliation=reconciliation,
            author=user,
            company=user.company,
            text=text,
            stage_number=stage_number,
        )

        write_audit(
            actor=request.user,
            event_type="reconciliation_chat_message_created",
            entity_type="reconciliation_chat_message",
            entity_id=chat_message.id,
            old_values={},
            new_values={
                "reconciliation_id": reconciliation.id,
                "stage_number": chat_message.stage_number,
                "author_id": chat_message.author_id,
                "author_username": request.user.username,
                "company_id": chat_message.company_id,
                "text": chat_message.text,
            },
            reason="chat message created in reconciliation",
            request=request,
        )

        return Response(
            {
                "ok": True,
                "data": ReconciliationChatMessageSerializer(chat_message).data,
            },
            status=201,
        )


    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        reconciliation = self.get_object()
        user = request.user

        if not user.company_id:
            raise PermissionDenied("User must belong to a company.")

        if user.company_id not in {
            reconciliation.master_company_id,
            reconciliation.slave_company_id,
        }:
            raise PermissionDenied("You do not have access to this reconciliation.")

        scope = str(request.query_params.get("scope", "stage") or "stage").strip().lower()
        if scope not in {"stage", "all"}:
            raise ValidationError("scope must be 'stage' or 'all'.")

        stage_number = None
        if scope == "stage":
            stage_number_raw = request.query_params.get("stage_number")
            if stage_number_raw in (None, ""):
                raise ValidationError("stage_number is required for stage export.")

            try:
                stage_number = int(stage_number_raw)
            except (TypeError, ValueError):
                raise ValidationError("stage_number must be an integer.")

            stage_exists = any(
                int(stage.stage_number) == int(stage_number)
                for stage in reconciliation.stages.all()
            )
            if not stage_exists:
                raise ValidationError("Stage not found for this reconciliation.")

        workbook = build_reconciliation_export_workbook(
            reconciliation=reconciliation,
            scope=scope,
            stage_number=stage_number,
        )

        output = BytesIO()
        workbook.save(output)
        output.seek(0)

        if scope == "all":
            filename = f"reconciliation_{reconciliation.id}_all_stages.xlsx"
        else:
            filename = f"reconciliation_{reconciliation.id}_stage_{stage_number}.xlsx"

        response = HttpResponse(
            output.getvalue(),
            content_type=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        
        write_audit(
            actor=request.user,
            event_type="reconciliation_exported",
            entity_type="reconciliation",
            entity_id=reconciliation.id,
            old_values={},
            new_values={
                "reconciliation_id": reconciliation.id,
                "stage": stage_param,
                "filename": filename,
                "master_company_id": reconciliation.master_company_id,
                "slave_company_id": reconciliation.slave_company_id,
                "period_start": (
                    reconciliation.period_start.isoformat()
                    if reconciliation.period_start
                    else None
                ),
                "period_end": (
                    reconciliation.period_end.isoformat()
                    if reconciliation.period_end
                    else None
                ),
            },
            reason="reconciliation exported",
            request=request,
        )

        return response

    @action(detail=True, methods=["post"], url_path="new-stage")
    def new_stage(self, request, pk=None):
        reconciliation = self.get_object()
        user = request.user

        if not user.company or user.company.company_type != "master":
            raise PermissionDenied("Only MASTER can start a new stage.")

        if user.company_id != reconciliation.master_company_id:
            raise PermissionDenied(
                "You can start a new stage only for your company reconciliation."
            )
        
        old_values = {
            "status": reconciliation.status,
            "current_stage_number": reconciliation.current_stage_number,
        }

        try:
            create_next_stage(reconciliation=reconciliation, created_by=user)
        except DjangoValidationError as exc:
            message = exc.messages if hasattr(exc, "messages") else str(exc)
            raise ValidationError(message)

        reconciliation.refresh_from_db()

        write_audit(
            actor=request.user,
            event_type="reconciliation_stage_created",
            entity_type="reconciliation",
            entity_id=reconciliation.id,
            old_values=old_values,
            new_values={
                "status": reconciliation.status,
                "current_stage_number": reconciliation.current_stage_number,
            },
            reason="new reconciliation stage created by master",
            request=request,
        )

        reconciliation = (
            Reconciliation.objects.select_related(
                "master_company",
                "slave_company",
                "created_by",
            )
            .prefetch_related(
                Prefetch(
                    "stages__items",
                    queryset=ReconciliationStageItem.objects.select_related(
                        "message",
                        "message__sender_company",
                        "message__receiver_company",
                    ).order_by("id"),
                ),
                "chat_messages__author",
                "chat_messages__company",
            )
            .get(pk=reconciliation.pk)
        )

        return Response(
            {
                "ok": True,
                "data": ReconciliationDetailSerializer(reconciliation).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="finish")
    def finish(self, request, pk=None):
        reconciliation = self.get_object()
        user = request.user

        if not user.company or user.company.company_type != "master":
            raise PermissionDenied("Only MASTER can finish reconciliation.")

        if user.company_id != reconciliation.master_company_id:
            raise PermissionDenied("You can finish only your company reconciliation.")

        old_values = {
            "status": reconciliation.status,
            "finished_at": reconciliation.finished_at.isoformat() if reconciliation.finished_at else None,
            "current_stage_number": reconciliation.current_stage_number,
        }

        try:
            finish_reconciliation(reconciliation=reconciliation, finished_by=user)
        except DjangoValidationError as exc:
            message = exc.messages if hasattr(exc, "messages") else str(exc)
            raise ValidationError(message)

        reconciliation.refresh_from_db()

        write_audit(
            actor=request.user,
            event_type="reconciliation_finished",
            entity_type="reconciliation",
            entity_id=reconciliation.id,
            old_values=old_values,
            new_values={
                "status": reconciliation.status,
                "finished_at": reconciliation.finished_at.isoformat() if reconciliation.finished_at else None,
                "current_stage_number": reconciliation.current_stage_number,
            },
            reason="reconciliation finished by master",
            request=request,
        )

        reconciliation = (
            Reconciliation.objects.select_related(
                "master_company",
                "slave_company",
                "created_by",
            )
            .prefetch_related(
                Prefetch(
                    "stages__items",
                    queryset=ReconciliationStageItem.objects.select_related(
                        "message",
                        "message__sender_company",
                        "message__receiver_company",
                    ).order_by("id"),
                ),
                "chat_messages__author",
                "chat_messages__company",
            )
            .get(pk=reconciliation.pk)
        )

        return Response(
            {
                "ok": True,
                "data": ReconciliationDetailSerializer(reconciliation).data,
            }
        )