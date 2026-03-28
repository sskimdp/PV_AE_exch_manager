from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.messages.api import (
    InboxViewSet,
    MessageComposeMetaView,
    MessageDraftViewSet,
    MessageSummaryView,
    SentViewSet,
)

router = DefaultRouter()
router.register(r"drafts", MessageDraftViewSet, basename="message-drafts")
router.register(r"inbox", InboxViewSet, basename="inbox")
router.register(r"sent", SentViewSet, basename="sent")

urlpatterns = [
    path("summary/", MessageSummaryView.as_view(), name="messages-summary"),
    path("compose-meta/", MessageComposeMetaView.as_view(), name="messages-compose-meta"),
    path("", include(router.urls)),
]
