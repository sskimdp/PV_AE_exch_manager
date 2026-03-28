from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.common.responses import ok


class CurrentUserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    is_company_admin = serializers.BooleanField()
    is_active = serializers.BooleanField()
    avatar_data_url = serializers.CharField(allow_null=True)
    company = serializers.SerializerMethodField()

    def get_company(self, obj):
        if not obj.company:
            return None
        return {
            "id": obj.company.id,
            "name": obj.company.name,
            "company_type": obj.company.company_type,
            "is_active": obj.company.is_active,
        }


class CurrentUserUpdateSerializer(serializers.Serializer):
    avatarDataUrl = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    avatar_data_url = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, attrs):
        attrs["resolved_avatar_data_url"] = attrs.get(
            "avatarDataUrl",
            attrs.get("avatar_data_url"),
        )
        return attrs


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["is_company_admin"] = user.is_company_admin
        token["company_id"] = user.company_id
        token["company_type"] = user.company.company_type if user.company else None
        token["company_is_active"] = user.company.is_active if user.company else None
        return token

    def validate(self, attrs):
        data = super().validate(attrs)

        if not self.user.is_active:
            raise AuthenticationFailed("User account is inactive.")
        if self.user.company and not self.user.company.is_active:
            raise AuthenticationFailed("Company account is inactive.")

        user_data = CurrentUserSerializer(self.user).data

        return {
            "access": data["access"],
            "refresh": data["refresh"],
            "user": user_data,
        }


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: CurrentUserSerializer})
    def get(self, request):
        return ok(CurrentUserSerializer(request.user).data)

    @extend_schema(
        request=CurrentUserUpdateSerializer,
        responses={200: CurrentUserSerializer},
    )
    def patch(self, request):
        serializer = CurrentUserUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        request.user.avatar_data_url = serializer.validated_data.get("resolved_avatar_data_url") or None
        request.user.save(update_fields=["avatar_data_url"])

        return ok(CurrentUserSerializer(request.user).data)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


@extend_schema(
    request=LogoutSerializer,
    responses={200: None},
)
class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        refresh_token = serializer.validated_data["refresh"]
        token = RefreshToken(refresh_token)
        token.blacklist()

        return ok({"logged_out": True})