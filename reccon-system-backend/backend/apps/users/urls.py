from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.users.api import UserAdminViewSet

router = DefaultRouter()
router.register(r"admin/users", UserAdminViewSet, basename="admin-users")

urlpatterns = [
    path("", include(router.urls)),
]
