
from django.conf import settings
from django.db import models

from apps.companies.models import Company
from apps.messages.models import Message


class Reconciliation(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_FINISHED = "finished"

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_FINISHED, "Finished"),
    ]

    master_company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name="master_reconciliations",
    )
    slave_company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name="slave_reconciliations",
    )

    period_start = models.DateField()
    period_end = models.DateField()

    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_reconciliations",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Reconciliation #{self.id}: {self.master_company} - {self.slave_company}"

    @property
    def current_stage(self):
        return self.stages.filter(status=ReconciliationStage.STATUS_ACTIVE).first()

    @property
    def latest_stage(self):
        return self.stages.order_by("-stage_number").first()

    @property
    def current_stage_number(self) -> int:
        stage = self.current_stage or self.latest_stage
        return stage.stage_number if stage else 0


class ReconciliationStage(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_FINISHED = "finished"

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_FINISHED, "Finished"),
    ]

    reconciliation = models.ForeignKey(
        Reconciliation,
        on_delete=models.CASCADE,
        related_name="stages",
    )

    stage_number = models.PositiveSmallIntegerField()
    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["stage_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["reconciliation", "stage_number"],
                name="unique_stage_number_per_reconciliation",
            )
        ]

    def __str__(self) -> str:
        return f"Reconciliation #{self.reconciliation_id} / Stage {self.stage_number}"

    @property
    def all_items_confirmed_by_slave(self) -> bool:
        return not self.items.filter(confirmed_by_slave=False).exists()


class ReconciliationStageItem(models.Model):
    STATUS_PENDING = "pending"
    STATUS_READ = "read"
    STATUS_CONFIRMED = "confirmed"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_READ, "Read"),
        (STATUS_CONFIRMED, "Confirmed"),
    ]

    stage = models.ForeignKey(
        ReconciliationStage,
        on_delete=models.CASCADE,
        related_name="items",
    )
    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="reconciliation_stage_items",
    )

    subject_snapshot = models.CharField(max_length=255)
    status_snapshot = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
    )
    sent_at_snapshot = models.DateTimeField(null=True, blank=True)
    confirmed_at_snapshot = models.DateTimeField(null=True, blank=True)

    confirmed_by_slave = models.BooleanField(default=False)
    confirmed_by_slave_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["stage", "message"],
                name="unique_message_per_stage",
            )
        ]

    def __str__(self) -> str:
        return f"StageItem #{self.id}: stage={self.stage_id}, message={self.message_id}"


class ReconciliationChatMessage(models.Model):
    reconciliation = models.ForeignKey(
        Reconciliation,
        on_delete=models.CASCADE,
        related_name="chat_messages",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reconciliation_chat_messages",
    )
    company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name="reconciliation_chat_messages",
    )

    text = models.TextField()
    stage_number = models.PositiveSmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"ChatMessage #{self.id} / reconciliation={self.reconciliation_id}"
