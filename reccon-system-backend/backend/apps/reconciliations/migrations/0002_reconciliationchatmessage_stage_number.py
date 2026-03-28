
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reconciliations", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="reconciliationchatmessage",
            name="stage_number",
            field=models.PositiveSmallIntegerField(default=1),
        ),
    ]
