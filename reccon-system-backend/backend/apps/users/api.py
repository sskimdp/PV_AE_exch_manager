from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from apps.common.responses import ok
from apps.companies.models import Company
from apps.users.models import User

ACTIVE_LABEL = "активен"
INACTIVE_LABEL = "неактивен"
ROLE_ADMIN_LABEL = "Администратор"
ROLE_USER_LABEL = "Пользователь"
PASSWORD_PLACEHOLDER = "********"


def status_label(is_active: bool) -> str:
    return ACTIVE_LABEL if is_active else INACTIVE_LABEL


def role_label(is_company_admin: bool) -> str:
    return ROLE_ADMIN_LABEL if is_company_admin else ROLE_USER_LABEL


class AdminUserListSerializer(serializers.ModelSerializer):
    login = serializers.CharField(source="username", read_only=True)
    companyName = serializers.CharField(source="company.name", read_only=True)
    company = serializers.CharField(source="company.name", read_only=True)
    companyId = serializers.IntegerField(source="company_id", read_only=True)
    companyType = serializers.CharField(source="company.company_type", read_only=True)
    role = serializers.SerializerMethodField()
    roleKey = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    avatarDataUrl = serializers.CharField(source="avatar_data_url", read_only=True)
    password = serializers.SerializerMethodField()
    isAdmin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "login",
            "username",
            "companyName",
            "company",
            "companyId",
            "companyType",
            "role",
            "roleKey",
            "status",
            "email",
            "password",
            "avatarDataUrl",
            "isAdmin",
        ]

    def get_role(self, obj):
        return role_label(obj.is_company_admin)

    def get_roleKey(self, obj):
        return "admin" if obj.is_company_admin else "user"

    def get_status(self, obj):
        return status_label(obj.is_active)

    def get_password(self, obj):
        return PASSWORD_PLACEHOLDER

    def get_isAdmin(self, obj):
        return obj.is_company_admin


class AdminUserWriteSerializer(serializers.Serializer):
    companyId = serializers.IntegerField(required=False)
    companyName = serializers.CharField(required=False, allow_blank=True)
    company = serializers.CharField(required=False, allow_blank=True)
    login = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128)
    role = serializers.CharField(required=False, allow_blank=True)
    roleKey = serializers.CharField(required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    avatarDataUrl = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    default_error_messages = {
        "company_required": "Компания обязательна.",
        "company_not_found": "Компания не найдена.",
        "login_taken": "Этот логин уже используется.",
    }

    def _resolve_role(self, attrs):
        role_value = str(attrs.get("roleKey") or attrs.get("role") or "").strip().lower()
        return role_value in {"admin", "администратор"}

    def _resolve_company(self, attrs):
        company_id = attrs.get("companyId")
        company_name = str(attrs.get("companyName") or attrs.get("company") or "").strip()

        if company_id:
            try:
                return Company.objects.get(pk=company_id)
            except Company.DoesNotExist as exc:
                raise ValidationError({"companyId": self.error_messages["company_not_found"]}) from exc

        if company_name:
            try:
                return Company.objects.get(name__iexact=company_name)
            except Company.DoesNotExist as exc:
                raise ValidationError({"companyName": self.error_messages["company_not_found"]}) from exc

        self.fail("company_required")

    def validate_login(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Логин обязателен.")
        instance = self.context.get("user_instance")
        query = User.objects.filter(username__iexact=value)
        if instance is not None:
            query = query.exclude(pk=instance.pk)
        if query.exists():
            self.fail("login_taken")
        return value

    def validate(self, attrs):
        request = self.context["request"]
        current_user = request.user
        target_company = self._resolve_company(attrs)

        if current_user.company.company_type == Company.TYPE_SLAVE and target_company.pk != current_user.company_id:
            raise PermissionDenied("Slave admin can manage only users of their own company.")

        if attrs.get("password") == PASSWORD_PLACEHOLDER:
            attrs["password"] = ""

        attrs["resolved_company"] = target_company
        attrs["resolved_is_company_admin"] = self._resolve_role(attrs)
        return attrs

    def create(self, validated_data):
        validated_data = dict(validated_data)
        company = validated_data.pop("resolved_company")
        is_company_admin = validated_data.pop("resolved_is_company_admin")
        login = validated_data["login"]
        password = validated_data["password"]

        with transaction.atomic():
            user = User.objects.create_user(
                username=login,
                password=password,
                email=validated_data.get("email") or "",
                company=company,
                is_company_admin=is_company_admin,
                is_active=True,
                avatar_data_url=validated_data.get("avatarDataUrl") or None,
            )
        return user

    def update(self, instance, validated_data):
        validated_data = dict(validated_data)
        company = validated_data.pop("resolved_company")
        is_company_admin = validated_data.pop("resolved_is_company_admin")
        password = validated_data.get("password")

        with transaction.atomic():
            instance.username = validated_data["login"]
            instance.email = validated_data.get("email") or ""
            instance.company = company
            instance.is_company_admin = is_company_admin
            instance.avatar_data_url = validated_data.get("avatarDataUrl") or None
            if password:
                instance.set_password(password)
            instance.save()
        return instance


class UserAdminViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AdminUserListSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def _require_company_admin(self):
        user = self.request.user
        if not user.is_authenticated or not user.is_company_admin or not user.company_id:
            raise PermissionDenied("Only company admins can access this endpoint.")
        return user

    def get_queryset(self):
        current_user = self._require_company_admin()
        queryset = User.objects.select_related("company").filter(company__isnull=False).order_by(
            "company__name", "-is_company_admin", "username", "id"
        )
        if current_user.company.company_type == Company.TYPE_MASTER:
            return queryset
        return queryset.filter(company_id=current_user.company_id)

    def get_serializer_class(self):
        if self.action in {"create", "partial_update", "update"}:
            return AdminUserWriteSerializer
        return AdminUserListSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action in {"partial_update", "update"}:
            context["user_instance"] = self.get_object()
        return context

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True)
        return ok(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return ok(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return ok(AdminUserListSerializer(user).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        user = self.get_object()
        current_user = self._require_company_admin()
        if current_user.company.company_type == Company.TYPE_SLAVE and user.company_id != current_user.company_id:
            raise PermissionDenied("Slave admin can edit only users of their own company.")
        serializer = self.get_serializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return ok(AdminUserListSerializer(user).data)

    @action(detail=True, methods=["post"], url_path="toggle-status")
    def toggle_status(self, request, pk=None):
        user = self.get_object()
        current_user = self._require_company_admin()
        if current_user.company.company_type == Company.TYPE_SLAVE and user.company_id != current_user.company_id:
            raise PermissionDenied("Slave admin can edit only users of their own company.")
        user.is_active = not user.is_active
        user.save(update_fields=["is_active"])
        return ok(AdminUserListSerializer(user).data)
