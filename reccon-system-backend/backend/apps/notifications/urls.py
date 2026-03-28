from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.notifications.api import NotificationViewSet, ReminderSettingsView

router = DefaultRouter()
router.register(r"notifications", NotificationViewSet, basename="notifications")

urlpatterns = [
    path("", include(router.urls)),
    path("admin/reminder-settings/", ReminderSettingsView.as_view(), name="admin-reminder-settings"),
]
