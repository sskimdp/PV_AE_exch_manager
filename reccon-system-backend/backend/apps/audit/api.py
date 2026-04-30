from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from apps.audit.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source="actor.username", read_only=True)
    actor_company = serializers.CharField(source="actor.company.name", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "created_at",
            "actor",
            "actor_username",
            "actor_company",
            "event_type",
            "entity_type",
            "entity_id",
            "payload",
        ]
        read_only_fields = fields


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user

        if not user.company_id:
            return AuditLog.objects.none()

        is_admin = (
            user.is_staff
            or user.is_superuser
            or getattr(user, "is_company_admin", False)
        )

        if not is_admin:
            raise PermissionDenied("Only administrators can view audit log.")

        queryset = (
            AuditLog.objects
            .select_related("actor", "actor__company")
            .filter(actor__company_id=user.company_id)
            .order_by("-created_at")
        )

        event_type = self.request.query_params.get("event_type")
        entity_type = self.request.query_params.get("entity_type")
        entity_id = self.request.query_params.get("entity_id")

        if event_type:
            queryset = queryset.filter(event_type=event_type)

        if entity_type:
            queryset = queryset.filter(entity_type=entity_type)

        if entity_id:
            queryset = queryset.filter(entity_id=str(entity_id))

        return queryset