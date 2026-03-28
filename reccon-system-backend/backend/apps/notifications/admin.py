from django.contrib import admin

from apps.notifications.models import CompanyReminderSettings, Notification, UserReminderDispatch


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "notif_type",
        "status",
        "is_read",
        "created_at",
        "read_at",
    )
    list_filter = ("notif_type", "status", "is_read")
    search_fields = ("title", "message", "user__username")


@admin.register(CompanyReminderSettings)
class CompanyReminderSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "company",
        "enabled",
        "interval_minutes",
        "send_inside",
        "send_email",
        "updated_at",
    )
    list_filter = ("enabled", "send_inside", "send_email")
    search_fields = ("company__name",)


@admin.register(UserReminderDispatch)
class UserReminderDispatchAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "company",
        "user",
        "channel",
        "last_sent_at",
        "updated_at",
    )
    list_filter = ("channel", "company")
    search_fields = ("company__name", "user__username", "user__email")
