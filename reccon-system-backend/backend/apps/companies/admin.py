from django.contrib import admin

from apps.companies.models import Company


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "company_type", "is_active", "master_partner", "created_at")
    list_filter = ("company_type", "is_active")
    search_fields = ("name",)
