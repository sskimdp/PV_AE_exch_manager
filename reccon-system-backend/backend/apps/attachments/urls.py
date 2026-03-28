from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.attachments.api import AttachmentViewSet

router = DefaultRouter()
router.register(r"attachments", AttachmentViewSet, basename="attachments")

urlpatterns = [
    path("", include(router.urls)),
]
