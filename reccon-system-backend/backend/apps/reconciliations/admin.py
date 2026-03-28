from django.contrib import admin

from apps.reconciliations.models import (
    Reconciliation,
    ReconciliationStage,
    ReconciliationStageItem,
    ReconciliationChatMessage,
)


class ReconciliationStageInline(admin.TabularInline):
    model = ReconciliationStage
    extra = 0
    readonly_fields = ("stage_number", "status", "created_at", "finished_at")
    show_change_link = True


@admin.register(Reconciliation)
class ReconciliationAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "master_company",
        "slave_company",
        "period_start",
        "period_end",
        "status",
        "current_stage_number",
        "created_at",
    )
    list_filter = ("status", "master_company", "slave_company")
    search_fields = ("master_company__name", "slave_company__name")
    inlines = [ReconciliationStageInline]


class ReconciliationStageItemInline(admin.TabularInline):
    model = ReconciliationStageItem
    extra = 0
    readonly_fields = (
        "message",
        "subject_snapshot",
        "status_snapshot",
        "sent_at_snapshot",
        "confirmed_at_snapshot",
        "confirmed_by_slave",
        "confirmed_by_slave_at",
        "created_at",
    )
    show_change_link = True


@admin.register(ReconciliationStage)
class ReconciliationStageAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "reconciliation",
        "stage_number",
        "status",
        "created_at",
        "finished_at",
        "all_items_confirmed_by_slave",
    )
    list_filter = ("status",)
    search_fields = ("reconciliation__id",)
    inlines = [ReconciliationStageItemInline]


@admin.register(ReconciliationStageItem)
class ReconciliationStageItemAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "stage",
        "message",
        "status_snapshot",
        "confirmed_by_slave",
        "confirmed_by_slave_at",
        "created_at",
    )
    list_filter = ("status_snapshot", "confirmed_by_slave")
    search_fields = ("message__subject",)


@admin.register(ReconciliationChatMessage)
class ReconciliationChatMessageAdmin(admin.ModelAdmin):
    list_display = ("id", "reconciliation", "author", "company", "created_at")
    list_filter = ("company",)
    search_fields = ("text", "author__username")
