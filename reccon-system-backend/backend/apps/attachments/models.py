from django.db import models

class Attachment(models.Model):
    STATUS_UPLOADED = "uploaded"
    STATUS_ATTACHED = "attached"
    STATUS_ORPHAN = "orphan"

    STATUS_CHOICES = [
        (STATUS_UPLOADED, "Uploaded"),
        (STATUS_ATTACHED, "Attached"),
        (STATUS_ORPHAN, "Orphan"),
    ]

    message = models.ForeignKey(
        "reccon_messages.Message",
        on_delete=models.CASCADE,
        related_name="attachments",
        null=True,
        blank=True,
    )

    storage_key = models.CharField(max_length=1024)  # ключ в MinIO
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255, blank=True)
    size = models.BigIntegerField(default=0)

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_UPLOADED)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.filename
