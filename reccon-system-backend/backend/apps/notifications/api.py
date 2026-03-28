from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.common.responses import ok
from apps.companies.models import Company
from apps.notifications.models import CompanyReminderSettings, Notification
from apps.messages.models import Message

INTERVAL_TO_LABEL = {
    30: "30 мин.",
    60: "1 час",
    120: "2 часа",
    360: "6 часов",
    720: "12 часов",
    1440: "24 часа",
}
LABEL_TO_INTERVAL = {value: key for key, value in INTERVAL_TO_LABEL.items()}
DEFAULT_INTERVAL = 30


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            "id",
            "notif_type",
            "status",
            "title",
            "message",
            "payload",
            "is_read",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields


class ReminderSettingsSerializer(serializers.ModelSerializer):
    companyName = serializers.CharField(source="company.name", read_only=True)
    intervalLabel = serializers.SerializerMethodField()
    channels = serializers.SerializerMethodField()
    intervalMinutes = serializers.IntegerField(source="interval_minutes", read_only=True)

    class Meta:
        model = CompanyReminderSettings
        fields = [
            "companyName",
            "enabled",
            "intervalLabel",
            "intervalMinutes",
            "channels",
            "updated_at",
        ]
        read_only_fields = fields

    def get_intervalLabel(self, obj):
        return INTERVAL_TO_LABEL.get(obj.interval_minutes, INTERVAL_TO_LABEL[DEFAULT_INTERVAL])

    def get_channels(self, obj):
        return {
            "inside": obj.send_inside,
            "email": obj.send_email,
        }


class ReminderSettingsWriteSerializer(serializers.Serializer):
    companyName = serializers.CharField(required=False, allow_blank=True)
    enabled = serializers.BooleanField(required=False)
    intervalLabel = serializers.ChoiceField(choices=list(LABEL_TO_INTERVAL.keys()), required=False)
    channels = serializers.DictField(required=False)

    def validate_channels(self, value):
        inside = bool(value.get("inside", True))
        email = bool(value.get("email", False))
        if not inside and not email:
            raise serializers.ValidationError("At least one reminder channel must stay enabled.")
        return {"inside": inside, "email": email}


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user).order_by("-created_at")

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return ok(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return ok(serializer.data)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        user = request.user

        if not user.is_authenticated or not user.company_id:
            return ok({"unread_count": 0})

    # Напоминания о неподтвержденных сообщениях нужны для MASTER,
    # потому что именно MASTER получает входящие и подтверждает их.
        if getattr(user.company, "company_type", None) != "master":
            return ok({"unread_count": 0})

        count = Message.objects.filter(
            receiver_company_id=user.company_id,
            status__in=[Message.STATUS_PENDING, Message.STATUS_READ],
        ).count()

        return ok({"unread_count": count})

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notif = self.get_object()

        if not notif.is_read:
            notif.is_read = True
            notif.read_at = timezone.now()
            notif.save(update_fields=["is_read", "read_at"])

        return ok(NotificationSerializer(notif).data)


class ReminderSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def _require_master_admin(self, request):
        user = request.user
        if not user.is_authenticated or not user.is_company_admin or not user.company_id:
            raise PermissionDenied("Only company admins can access reminder settings.")
        if user.company.company_type != Company.TYPE_MASTER:
            raise PermissionDenied("Only master company admin can manage reminder settings.")
        return user

    def _resolve_company(self, request):
        user = self._require_master_admin(request)
        company_name = str(request.query_params.get("companyName") or request.data.get("companyName") or "").strip()
        if company_name:
            try:
                return Company.objects.get(name__iexact=company_name)
            except Company.DoesNotExist as exc:
                raise ValidationError({"companyName": "Company not found."}) from exc
        return user.company

    def get(self, request):
        company = self._resolve_company(request)
        settings, _ = CompanyReminderSettings.objects.get_or_create(company=company)
        return ok(ReminderSettingsSerializer(settings).data)

    def put(self, request):
        company = self._resolve_company(request)
        settings, _ = CompanyReminderSettings.objects.get_or_create(company=company)
        serializer = ReminderSettingsWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "enabled" in data:
            settings.enabled = data["enabled"]
        if "intervalLabel" in data:
            settings.interval_minutes = LABEL_TO_INTERVAL[data["intervalLabel"]]
        if "channels" in data:
            settings.send_inside = data["channels"]["inside"]
            settings.send_email = data["channels"]["email"]
        settings.save()
        return ok(ReminderSettingsSerializer(settings).data)
