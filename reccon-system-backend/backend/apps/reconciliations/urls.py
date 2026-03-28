from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.reconciliations.api import ReconciliationViewSet

router = DefaultRouter()
router.register(r"reconciliations", ReconciliationViewSet, basename="reconciliations")

urlpatterns = [
    path("", include(router.urls)),
]
