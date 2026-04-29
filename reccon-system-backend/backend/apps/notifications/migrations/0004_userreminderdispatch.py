from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0003_company_is_active"),
        ("notifications", "0003_companyremindersettings"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserReminderDispatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "channel",
                    models.CharField(
                        choices=[("inside", "Inside"), ("email", "Email")],
                        max_length=16,
                    ),
                ),
                ("last_sent_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reminder_dispatches",
                        to="companies.company",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reminder_dispatches",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "User reminder dispatch",
                "verbose_name_plural": "User reminder dispatches",
                "ordering": ["company__name", "user__username", "channel", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="userreminderdispatch",
            constraint=models.UniqueConstraint(
                fields=("user", "company", "channel"),
                name="unique_user_company_channel_reminder_dispatch",
            ),
        ),
    ]
