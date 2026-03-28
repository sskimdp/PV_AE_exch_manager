from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from apps.users.auth_api import CustomTokenObtainPairView, MeView, LogoutView

urlpatterns = [
    path("login/", CustomTokenObtainPairView.as_view(), name="jwt-login"),
    path("refresh/", TokenRefreshView.as_view(), name="jwt-refresh"),
    path("me/", MeView.as_view(), name="jwt-me"),
    path("logout/", LogoutView.as_view(), name="jwt-logout"),
]
