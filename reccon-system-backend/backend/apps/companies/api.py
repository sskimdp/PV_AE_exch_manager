from django.db import transaction
from django.db.models import Count, Prefetch, Q
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from apps.common.responses import ok
from apps.companies.models import Company
from apps.users.models import User

ACTIVE_LABEL = "активен"
INACTIVE_LABEL = "неактивен"
PASSWORD_PLACEHOLDER = "********"


def status_label(is_active: bool) -> str:
    return ACTIVE_LABEL if is_active else INACTIVE_LABEL


class AdminAccessMixin:
    permission_classes = [IsAuthenticated]

    def _require_company_admin(self, request):
        user = request.user
        if not user.is_authenticated or not user.is_company_admin or not user.company_id:
            raise PermissionDenied("Only company admins can access this endpoint.")
        return user


class CompanyBaseSerializer(serializers.ModelSerializer):
    master_partner_id = serializers.IntegerField(read_only=True)
    master_partner_name = serializers.CharField(source="master_partner.name", read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = [
            "id",
            "name",
            "company_type",
            "master_partner_id",
            "master_partner_name",
            "created_at",
            "is_active",
            "status",
        ]
        read_only_fields = fields

    def get_status(self, obj):
        return status_label(obj.is_active)


class CompanyAdminListSerializer(serializers.ModelSerializer):
    adminUserId = serializers.SerializerMethodField()
    adminLogin = serializers.SerializerMethodField()
    adminEmail = serializers.SerializerMethodField()
    adminPassword = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    usersCount = serializers.IntegerField(source="users_count", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    companyType = serializers.CharField(source="company_type", read_only=True)

    class Meta:
        model = Company
        fields = [
            "id",
            "name",
            "companyType",
            "adminUserId",
            "adminLogin",
            "adminEmail",
            "adminPassword",
            "status",
            "usersCount",
            "createdAt",
        ]

    def _get_admin_user(self, obj):
        admin = getattr(obj, "_admin_user", None)
        if admin is not None:
            return admin
        admins = getattr(obj, "prefetched_admin_users", None)
        if admins is not None:
            return admins[0] if admins else None
        return obj.users.filter(is_company_admin=True).order_by("id").first()

    def get_adminUserId(self, obj):
        admin = self._get_admin_user(obj)
        return admin.id if admin else None

    def get_adminLogin(self, obj):
        admin = self._get_admin_user(obj)
        return admin.username if admin else ""

    def get_adminEmail(self, obj):
        admin = self._get_admin_user(obj)
        return admin.email if admin else None

    def get_adminPassword(self, obj):
        return PASSWORD_PLACEHOLDER

    def get_status(self, obj):
        return status_label(obj.is_active)


class CompanyAdminWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    adminLogin = serializers.CharField(max_length=150)
    adminPassword = serializers.CharField(max_length=128, required=False, allow_blank=True)
    adminEmail = serializers.EmailField(required=False, allow_blank=True, allow_null=True)

    default_error_messages = {
        "company_name_taken": "Компания с таким названием уже существует.",
        "admin_login_taken": "Этот логин уже используется.",
        "password_required": "Пароль администратора обязателен.",
    }

    def _get_admin_user(self, company):
        return company.users.filter(is_company_admin=True).order_by("id").first()

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Название компании обязательно.")
        instance = self.context.get("company")
        query = Company.objects.filter(name__iexact=value)
        if instance is not None:
            query = query.exclude(pk=instance.pk)
        if query.exists():
            self.fail("company_name_taken")
        return value

    def validate_adminLogin(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Логин администратора обязателен.")

        instance = self.context.get("company")
        excluded_user_id = None
        if instance is not None:
            admin = self._get_admin_user(instance)
            excluded_user_id = admin.id if admin else None

        query = User.objects.filter(username__iexact=value)
        if excluded_user_id is not None:
            query = query.exclude(pk=excluded_user_id)
        if query.exists():
            self.fail("admin_login_taken")
        return value

    def validate(self, attrs):
        password = attrs.get("adminPassword")
        if self.context.get("company") is None and not password:
            self.fail("password_required")
        if password == PASSWORD_PLACEHOLDER:
            attrs["adminPassword"] = ""
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        current_user = request.user
        if current_user.company.company_type != Company.TYPE_MASTER:
            raise PermissionDenied("Only master company admins can create companies.")

        with transaction.atomic():
            company = Company.objects.create(
                name=validated_data["name"],
                company_type=Company.TYPE_SLAVE,
                master_partner=current_user.company,
                is_active=True,
            )
            admin_user = User.objects.create_user(
                username=validated_data["adminLogin"],
                password=validated_data["adminPassword"],
                email=validated_data.get("adminEmail") or "",
                company=company,
                is_company_admin=True,
                is_active=True,
            )
        company._admin_user = admin_user
        company.users_count = company.users.count()
        return company

    def update(self, instance, validated_data):
        request = self.context["request"]
        current_user = request.user
        if current_user.company.company_type != Company.TYPE_MASTER:
            raise PermissionDenied("Only master company admins can edit companies.")
        if instance.company_type != Company.TYPE_SLAVE:
            raise PermissionDenied("Only slave companies can be edited from this screen.")
        if instance.master_partner_id not in {None, current_user.company_id}:
            raise PermissionDenied("You can edit only your own partner companies.")

        admin_user = self._get_admin_user(instance)
        with transaction.atomic():
            instance.name = validated_data.get("name", instance.name)
            instance.company_type = Company.TYPE_SLAVE
            instance.master_partner = current_user.company
            instance.save(update_fields=["name", "company_type", "master_partner"])

            password = validated_data.get("adminPassword")
            if admin_user is None:
                admin_user = User.objects.create_user(
                    username=validated_data["adminLogin"],
                    password=password or User.objects.make_random_password(),
                    email=validated_data.get("adminEmail") or "",
                    company=instance,
                    is_company_admin=True,
                    is_active=True,
                )
            else:
                admin_user.username = validated_data.get("adminLogin", admin_user.username)
                admin_user.email = validated_data.get("adminEmail") or ""
                if password:
                    admin_user.set_password(password)
                admin_user.company = instance
                admin_user.is_company_admin = True
                admin_user.save()

        instance._admin_user = admin_user
        instance.users_count = instance.users.count()
        return instance


class CompanyViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = CompanyBaseSerializer

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not user.company_id:
            raise PermissionDenied("User is not attached to a company.")
        queryset = Company.objects.select_related("master_partner")
        if user.company.company_type == Company.TYPE_MASTER:
            return queryset.order_by("name", "id")
        return queryset.filter(Q(pk=user.company_id) | Q(pk=user.company.master_partner_id)).order_by("name", "id")

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True)
        return ok(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return ok(serializer.data)


class CompanyAdminViewSet(AdminAccessMixin, viewsets.ModelViewSet):
    serializer_class = CompanyAdminListSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        user = self._require_company_admin(self.request)
        if user.company.company_type != Company.TYPE_MASTER:
            raise PermissionDenied("Only master company admins can manage companies.")

        return (
            Company.objects.select_related("master_partner")
            .prefetch_related(
                Prefetch(
                    "users",
                    queryset=User.objects.filter(is_company_admin=True).order_by("id"),
                    to_attr="prefetched_admin_users",
                )
            )
            .annotate(users_count=Count("users", distinct=True))
            .filter(Q(pk=user.company_id) | Q(master_partner=user.company))
            .order_by("name", "id")
        )

    def get_serializer_class(self):
        if self.action in {"create", "partial_update", "update"}:
            return CompanyAdminWriteSerializer
        return CompanyAdminListSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action in {"partial_update", "update"}:
            context["company"] = self.get_object()
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
        company = serializer.save()
        return ok(CompanyAdminListSerializer(company).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        company = self.get_object()
        serializer = self.get_serializer(company, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        company = serializer.save()
        return ok(CompanyAdminListSerializer(company).data)

    @action(detail=True, methods=["post"], url_path="toggle-status")
    def toggle_status(self, request, pk=None):
        company = self.get_object()
        company.is_active = not company.is_active
        company.save(update_fields=["is_active"])
        return ok(CompanyAdminListSerializer(company).data)
