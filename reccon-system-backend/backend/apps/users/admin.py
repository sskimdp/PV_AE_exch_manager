from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.users.models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "id",
        "username",
        "email",
        "company",
        "is_company_admin",
        "is_staff",
        "is_active",
    )
    list_filter = ("is_company_admin", "is_staff", "is_active", "company")
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Company", {"fields": ("company", "is_company_admin", "avatar_data_url")}),
    )
