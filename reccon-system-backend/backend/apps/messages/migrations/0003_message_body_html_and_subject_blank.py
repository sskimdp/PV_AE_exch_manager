from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("reccon_messages", "0002_messagenumbercounter_message_receiver_number_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="body_html",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AlterField(
            model_name="message",
            name="subject",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AlterField(
            model_name="message",
            name="body",
            field=models.TextField(blank=True, default=""),
        ),
    ]
