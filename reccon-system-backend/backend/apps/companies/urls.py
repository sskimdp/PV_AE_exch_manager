from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.companies.api import CompanyAdminViewSet, CompanyViewSet

router = DefaultRouter()
router.register(r"companies", CompanyViewSet, basename="companies")
router.register(r"admin/companies", CompanyAdminViewSet, basename="admin-companies")

urlpatterns = [
    path("", include(router.urls)),
]
