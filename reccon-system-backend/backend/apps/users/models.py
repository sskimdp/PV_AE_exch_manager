from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    company = models.ForeignKey(
        "companies.Company",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
    )
    is_company_admin = models.BooleanField(default=False)
    avatar_data_url = models.TextField(null=True, blank=True)

    class Meta:
        ordering = ["company__name", "-is_company_admin", "username", "id"]

    def __str__(self) -> str:
        return self.username
