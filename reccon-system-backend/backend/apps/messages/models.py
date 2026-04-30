from django.conf import settings
from django.db import models


class Message(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_PENDING = "pending"
    STATUS_READ = "read"
    STATUS_CONFIRMED = "confirmed"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PENDING, "Pending"),
        (STATUS_READ, "Read"),
        (STATUS_CONFIRMED, "Confirmed"),
    ]

    sender_company = models.ForeignKey(
        "companies.Company",
        on_delete=models.PROTECT,
        related_name="sent_messages",
    )
    receiver_company = models.ForeignKey(
        "companies.Company",
        on_delete=models.PROTECT,
        related_name="received_messages",
    )

    late_send_reconciliation = models.ForeignKey(
        "reconciliations.Reconciliation",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="late_sent_messages",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_messages",
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="confirmed_messages",
    )

    sender_number = models.CharField(max_length=16, null=True, blank=True)
    receiver_number = models.CharField(max_length=16, null=True, blank=True)

    status = models.CharField(max_length=16, choices=STATUS_CHOICES)

    subject = models.CharField(max_length=255, blank=True, default="")
    body = models.TextField(blank=True, default="")
    body_html = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    read_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deleted_messages",
    )
    delete_reason = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["sender_company", "sender_number"],
                name="unique_sender_number_per_sender_company",
            ),
            models.UniqueConstraint(
                fields=["receiver_company", "receiver_number"],
                name="unique_receiver_number_per_receiver_company",
            ),
        ]

    def __str__(self) -> str:
        return f"Message #{self.id}"


class MessageNumberCounter(models.Model):
    TYPE_SENDER = "sender"
    TYPE_RECEIVER = "receiver"

    TYPE_CHOICES = [
        (TYPE_SENDER, "Sender"),
        (TYPE_RECEIVER, "Receiver"),
    ]

    company = models.ForeignKey(
        "companies.Company",
        on_delete=models.CASCADE,
        related_name="message_number_counters",
    )
    counter_type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    last_value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["company", "counter_type"],
                name="unique_counter_type_per_company",
            )
        ]

    def __str__(self) -> str:
        return f"{self.company} / {self.counter_type} / {self.last_value}"