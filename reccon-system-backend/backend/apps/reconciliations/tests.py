from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from apps.companies.models import Company
from apps.messages.models import Message
from apps.reconciliations.export import build_reconciliation_export_workbook
from apps.reconciliations.models import (
    Reconciliation,
    ReconciliationStage,
    ReconciliationStageItem,
)
from apps.reconciliations.services import (
    create_next_stage,
    create_reconciliation_with_first_stage,
    finish_reconciliation,
)


User = get_user_model()


class ReconciliationTestDataMixin:
    def setUp(self):
        self.master = Company.objects.create(
            name="Master Company",
            company_type=Company.TYPE_MASTER,
        )
        self.slave = Company.objects.create(
            name="Slave Company",
            company_type=Company.TYPE_SLAVE,
            master_partner=self.master,
        )

        self.master_user = User.objects.create_user(
            username="master_user",
            password="testpass123",
            company=self.master,
        )
        self.slave_user = User.objects.create_user(
            username="slave_user",
            password="testpass123",
            company=self.slave,
        )

        self.today = timezone.localdate()

    def create_message(self, *, status=Message.STATUS_PENDING, subject="Test message"):
        return Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=status,
            subject=subject,
            body="Message body",
        )

    def create_reconciliation(self):
        return create_reconciliation_with_first_stage(
            created_by=self.master_user,
            master_company=self.master,
            slave_company=self.slave,
            period_start=self.today,
            period_end=self.today,
        )


class ReconciliationServiceTests(ReconciliationTestDataMixin, TestCase):
    def test_create_reconciliation_creates_active_reconciliation_and_stage_one(self):
        reconciliation = self.create_reconciliation()

        self.assertEqual(reconciliation.status, Reconciliation.STATUS_ACTIVE)
        self.assertEqual(reconciliation.master_company, self.master)
        self.assertEqual(reconciliation.slave_company, self.slave)
        self.assertEqual(reconciliation.created_by, self.master_user)

        stage = reconciliation.stages.get()
        self.assertEqual(stage.stage_number, 1)
        self.assertEqual(stage.status, ReconciliationStage.STATUS_ACTIVE)

    def test_create_reconciliation_adds_messages_for_period_to_stage(self):
        message = self.create_message(status=Message.STATUS_PENDING)

        reconciliation = self.create_reconciliation()
        stage = reconciliation.stages.get()

        self.assertEqual(stage.items.count(), 1)
        item = stage.items.get()
        self.assertEqual(item.message, message)
        self.assertEqual(item.subject_snapshot, message.subject)
        self.assertEqual(item.status_snapshot, Message.STATUS_PENDING)

    def test_draft_messages_do_not_enter_reconciliation_stage(self):
        self.create_message(status=Message.STATUS_DRAFT)

        reconciliation = self.create_reconciliation()
        stage = reconciliation.stages.get()

        self.assertEqual(stage.items.count(), 0)

    def test_snapshot_does_not_change_when_message_changes_later(self):
        message = self.create_message(
            status=Message.STATUS_PENDING,
            subject="Original subject",
        )

        reconciliation = self.create_reconciliation()
        item = reconciliation.stages.get().items.get()

        message.status = Message.STATUS_CONFIRMED
        message.subject = "Changed subject"
        message.confirmed_at = timezone.now()
        message.save(update_fields=["status", "subject", "confirmed_at", "updated_at"])

        item.refresh_from_db()

        self.assertEqual(item.subject_snapshot, "Original subject")
        self.assertEqual(item.status_snapshot, Message.STATUS_PENDING)
        self.assertIsNone(item.confirmed_at_snapshot)

    def test_create_next_stage_requires_all_items_confirmed_by_slave(self):
        self.create_message(status=Message.STATUS_PENDING)
        reconciliation = self.create_reconciliation()

        with self.assertRaises(ValidationError):
            create_next_stage(
                reconciliation=reconciliation,
                created_by=self.master_user,
            )

    def test_create_next_stage_finishes_previous_stage_and_creates_new_active_stage(self):
        self.create_message(status=Message.STATUS_PENDING)
        reconciliation = self.create_reconciliation()

        first_stage = reconciliation.current_stage
        first_stage.items.update(
            confirmed_by_slave=True,
            confirmed_by_slave_at=timezone.now(),
        )

        new_stage = create_next_stage(
            reconciliation=reconciliation,
            created_by=self.master_user,
        )

        first_stage.refresh_from_db()

        self.assertEqual(first_stage.status, ReconciliationStage.STATUS_FINISHED)
        self.assertIsNotNone(first_stage.finished_at)
        self.assertEqual(new_stage.stage_number, 2)
        self.assertEqual(new_stage.status, ReconciliationStage.STATUS_ACTIVE)

    def test_late_send_message_enters_next_stage_even_if_outside_period(self):
        old_period_start = self.today - timedelta(days=10)
        old_period_end = self.today - timedelta(days=5)

        reconciliation = create_reconciliation_with_first_stage(
            created_by=self.master_user,
            master_company=self.master,
            slave_company=self.slave,
            period_start=old_period_start,
            period_end=old_period_end,
        )

        self.assertEqual(reconciliation.current_stage.items.count(), 0)

        late_message = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            late_send_reconciliation=reconciliation,
            status=Message.STATUS_PENDING,
            subject="Late message",
        )

        new_stage = create_next_stage(
            reconciliation=reconciliation,
            created_by=self.master_user,
        )

        self.assertEqual(new_stage.items.count(), 1)
        self.assertEqual(new_stage.items.get().message, late_message)

    def test_finish_reconciliation_requires_all_items_confirmed_by_slave(self):
        self.create_message(status=Message.STATUS_PENDING)
        reconciliation = self.create_reconciliation()

        with self.assertRaises(ValidationError):
            finish_reconciliation(
                reconciliation=reconciliation,
                finished_by=self.master_user,
            )

    def test_finish_reconciliation_finishes_current_stage_and_reconciliation(self):
        self.create_message(status=Message.STATUS_PENDING)
        reconciliation = self.create_reconciliation()

        current_stage = reconciliation.current_stage
        current_stage.items.update(
            confirmed_by_slave=True,
            confirmed_by_slave_at=timezone.now(),
        )

        finish_reconciliation(
            reconciliation=reconciliation,
            finished_by=self.master_user,
        )

        reconciliation.refresh_from_db()
        current_stage.refresh_from_db()

        self.assertEqual(reconciliation.status, Reconciliation.STATUS_FINISHED)
        self.assertIsNotNone(reconciliation.finished_at)
        self.assertEqual(current_stage.status, ReconciliationStage.STATUS_FINISHED)
        self.assertIsNotNone(current_stage.finished_at)

    def test_cannot_create_duplicate_active_reconciliation_for_same_period(self):
        self.create_reconciliation()

        with self.assertRaises(ValidationError):
            self.create_reconciliation()

    def test_cannot_create_more_than_ten_stages(self):
        reconciliation = self.create_reconciliation()

        for _ in range(9):
            stage = reconciliation.current_stage
            stage.items.update(
                confirmed_by_slave=True,
                confirmed_by_slave_at=timezone.now(),
            )
            create_next_stage(
                reconciliation=reconciliation,
                created_by=self.master_user,
            )
            reconciliation.refresh_from_db()

        self.assertEqual(reconciliation.current_stage_number, 10)

        with self.assertRaises(ValidationError):
            create_next_stage(
                reconciliation=reconciliation,
                created_by=self.master_user,
            )


class ReconciliationExportTests(ReconciliationTestDataMixin, TestCase):
    def test_export_single_stage_creates_stage_sheet(self):
        self.create_message(status=Message.STATUS_PENDING)
        reconciliation = self.create_reconciliation()

        workbook = build_reconciliation_export_workbook(
            reconciliation=reconciliation,
            scope="stage",
            stage_number=1,
        )

        self.assertIn("Этап 1", workbook.sheetnames)
        self.assertEqual(len(workbook.sheetnames), 1)

    def test_export_all_stages_creates_all_stages_sheet(self):
        self.create_message(status=Message.STATUS_PENDING)
        reconciliation = self.create_reconciliation()

        workbook = build_reconciliation_export_workbook(
            reconciliation=reconciliation,
            scope="all",
        )

        self.assertIn("Все этапы", workbook.sheetnames)
        self.assertIn("Этап 1", workbook.sheetnames)

    def test_export_uses_snapshot_subject_and_status(self):
        message = self.create_message(
            status=Message.STATUS_PENDING,
            subject="Snapshot subject",
        )
        reconciliation = self.create_reconciliation()

        message.subject = "Changed later"
        message.status = Message.STATUS_CONFIRMED
        message.save(update_fields=["subject", "status", "updated_at"])

        workbook = build_reconciliation_export_workbook(
            reconciliation=reconciliation,
            scope="stage",
            stage_number=1,
        )
        worksheet = workbook["Этап 1"]

        self.assertEqual(worksheet["D9"].value, "Snapshot subject")
        self.assertEqual(worksheet["G9"].value, "Ожидает подтверждения")

    def test_export_uses_without_subject_label_for_empty_subject(self):
        self.create_message(status=Message.STATUS_PENDING, subject="")
        reconciliation = self.create_reconciliation()

        workbook = build_reconciliation_export_workbook(
            reconciliation=reconciliation,
            scope="stage",
            stage_number=1,
        )
        worksheet = workbook["Этап 1"]

        self.assertEqual(worksheet["D9"].value, "Без темы")

    def test_export_unknown_stage_raises_value_error(self):
        reconciliation = self.create_reconciliation()

        with self.assertRaises(ValueError):
            build_reconciliation_export_workbook(
                reconciliation=reconciliation,
                scope="stage",
                stage_number=999,
            )