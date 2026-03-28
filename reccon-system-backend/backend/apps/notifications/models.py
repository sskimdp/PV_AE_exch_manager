from django.db import models


class Notification(models.Model):
    STATUS_NEW = "new"
    STATUS_SENT = "sent"
    STATUS_FAILED = "failed"

    STATUS_CHOICES = [
        (STATUS_NEW, "New"),
        (STATUS_SENT, "Sent"),
        (STATUS_FAILED, "Failed"),
    ]

    TYPE_SYSTEM = "system"
    TYPE_REMINDER = "reminder"
    TYPE_RECONCILIATION = "reconciliation"
    TYPE_MESSAGE = "message"

    TYPE_CHOICES = [
        (TYPE_SYSTEM, "System"),
        (TYPE_REMINDER, "Reminder"),
        (TYPE_RECONCILIATION, "Reconciliation"),
        (TYPE_MESSAGE, "Message"),
    ]

    user = models.ForeignKey(
        "users.User",
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    notif_type = models.CharField(max_length=32, choices=TYPE_CHOICES, default=TYPE_SYSTEM)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEW)

    title = models.CharField(max_length=255, blank=True)
    message = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)

    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.notif_type} [{self.status}] #{self.id}"


class CompanyReminderSettings(models.Model):
    company = models.OneToOneField(
        "companies.Company",
        on_delete=models.CASCADE,
        related_name="reminder_settings",
    )
    enabled = models.BooleanField(default=True)
    interval_minutes = models.PositiveIntegerField(default=30)
    send_inside = models.BooleanField(default=True)
    send_email = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Company reminder settings"
        verbose_name_plural = "Company reminder settings"

    def __str__(self) -> str:
        return f"Reminder settings for {self.company.name}"


class UserReminderDispatch(models.Model):
    CHANNEL_INSIDE = "inside"
    CHANNEL_EMAIL = "email"

    CHANNEL_CHOICES = [
        (CHANNEL_INSIDE, "Inside"),
        (CHANNEL_EMAIL, "Email"),
    ]

    user = models.ForeignKey(
        "users.User",
        on_delete=models.CASCADE,
        related_name="reminder_dispatches",
    )
    company = models.ForeignKey(
        "companies.Company",
        on_delete=models.CASCADE,
        related_name="reminder_dispatches",
    )
    channel = models.CharField(max_length=16, choices=CHANNEL_CHOICES)
    last_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "User reminder dispatch"
        verbose_name_plural = "User reminder dispatches"
        ordering = ["company__name", "user__username", "channel", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "company", "channel"],
                name="unique_user_company_channel_reminder_dispatch",
            )
        ]

    def __str__(self) -> str:
        return f"{self.company.name} / {self.user.username} / {self.channel}"
