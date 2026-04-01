from django.urls import path

from apps.users.auth_api import (
    CustomTokenObtainPairView,
    CustomTokenRefreshView,
    LogoutView,
    MeView,
)

urlpatterns = [
    path("login/", CustomTokenObtainPairView.as_view(), name="jwt-login"),
    path("refresh/", CustomTokenRefreshView.as_view(), name="jwt-refresh"),
    path("me/", MeView.as_view(), name="jwt-me"),
    path("logout/", LogoutView.as_view(), name="jwt-logout"),
]
