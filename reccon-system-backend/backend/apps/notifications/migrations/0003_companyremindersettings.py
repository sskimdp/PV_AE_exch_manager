from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0003_company_is_active"),
        ("notifications", "0002_alter_notification_options_notification_is_read_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyReminderSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=True)),
                ("interval_minutes", models.PositiveIntegerField(default=30)),
                ("send_inside", models.BooleanField(default=True)),
                ("send_email", models.BooleanField(default=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reminder_settings",
                        to="companies.company",
                    ),
                ),
            ],
            options={
                "verbose_name": "Company reminder settings",
                "verbose_name_plural": "Company reminder settings",
            },
        ),
    ]
