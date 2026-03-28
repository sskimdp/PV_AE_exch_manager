from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0002_company_master_partner"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
    ]
