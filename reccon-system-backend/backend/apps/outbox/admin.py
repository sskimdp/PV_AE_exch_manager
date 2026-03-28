from django.contrib import admin

from apps.outbox.models import OutboxEvent


@admin.register(OutboxEvent)
class OutboxEventAdmin(admin.ModelAdmin):
    list_display = ("id", "event_type", "status", "attempts", "created_at", "processed_at")
    list_filter = ("status", "event_type")
    search_fields = ("event_type",)
