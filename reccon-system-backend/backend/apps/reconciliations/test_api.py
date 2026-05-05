from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.companies.models import Company
from apps.messages.models import Message
from apps.reconciliations.models import Reconciliation


User = get_user_model()


class ReconciliationsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.master = Company.objects.create(
            name="Master Company",
            company_type=Company.TYPE_MASTER,
        )
        self.slave = Company.objects.create(
            name="Slave Company",
            company_type=Company.TYPE_SLAVE,
            master_partner=self.master,
        )

        self.master_admin = User.objects.create_user(
            username="master_admin",
            password="testpass123",
            company=self.master,
            is_company_admin=True,
        )
        self.slave_user = User.objects.create_user(
            username="slave_user",
            password="testpass123",
            company=self.slave,
        )

        self.today = timezone.localdate()

    def authenticate_master(self):
        self.client.force_authenticate(user=self.master_admin)

    def authenticate_slave(self):
        self.client.force_authenticate(user=self.slave_user)

    def create_message(self, status=Message.STATUS_PENDING):
        return Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=status,
            subject="Message for reconciliation",
            body="Body",
        )

    def create_reconciliation(self):
        self.authenticate_master()
        response = self.client.post(
            "/api/reconciliations/",
            {
                "slave_company": self.slave.id,
                "period_start": self.today.isoformat(),
                "period_end": self.today.isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        return Reconciliation.objects.get()

    def test_master_can_create_reconciliation_and_audit_is_written(self):
        self.create_message()

        reconciliation = self.create_reconciliation()

        self.assertEqual(reconciliation.status, Reconciliation.STATUS_ACTIVE)
        self.assertEqual(reconciliation.stages.count(), 1)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reconciliation_created",
                entity_type="reconciliation",
                entity_id=str(reconciliation.id),
            ).exists()
        )

    def test_slave_can_bulk_confirm_stage_items_and_audit_is_written(self):
        self.create_message()
        reconciliation = self.create_reconciliation()
        stage = reconciliation.current_stage
        item = stage.items.get()

        self.authenticate_slave()

        response = self.client.post(
            f"/api/reconciliations/{reconciliation.id}/bulk-confirm/",
            {"item_ids": [item.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        item.refresh_from_db()
        self.assertTrue(item.confirmed_by_slave)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reconciliation_items_confirmed_by_slave",
                entity_type="reconciliation",
                entity_id=str(reconciliation.id),
            ).exists()
        )

    def test_chat_message_creates_audit(self):
        reconciliation = self.create_reconciliation()

        self.authenticate_slave()

        response = self.client.post(
            f"/api/reconciliations/{reconciliation.id}/chat/",
            {
                "text": "Please check this stage.",
                "stage_number": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reconciliation_chat_message_created",
                entity_type="reconciliation_chat_message",
            ).exists()
        )

    def test_master_can_create_new_stage_and_audit_is_written(self):
        self.create_message()
        reconciliation = self.create_reconciliation()

        stage = reconciliation.current_stage
        stage.items.update(
            confirmed_by_slave=True,
            confirmed_by_slave_at=timezone.now(),
        )

        self.authenticate_master()

        response = self.client.post(
            f"/api/reconciliations/{reconciliation.id}/new-stage/"
        )

        self.assertEqual(response.status_code, 200)

        reconciliation.refresh_from_db()
        self.assertEqual(reconciliation.current_stage_number, 2)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reconciliation_stage_created",
                entity_type="reconciliation",
                entity_id=str(reconciliation.id),
            ).exists()
        )

    def test_master_can_finish_reconciliation_and_audit_is_written(self):
        self.create_message()
        reconciliation = self.create_reconciliation()

        stage = reconciliation.current_stage
        stage.items.update(
            confirmed_by_slave=True,
            confirmed_by_slave_at=timezone.now(),
        )

        self.authenticate_master()

        response = self.client.post(
            f"/api/reconciliations/{reconciliation.id}/finish/"
        )

        self.assertEqual(response.status_code, 200)

        reconciliation.refresh_from_db()
        self.assertEqual(reconciliation.status, Reconciliation.STATUS_FINISHED)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reconciliation_finished",
                entity_type="reconciliation",
                entity_id=str(reconciliation.id),
            ).exists()
        )

    def test_export_stage_writes_audit(self):
        self.create_message()
        reconciliation = self.create_reconciliation()

        self.authenticate_master()

        response = self.client.get(
            f"/api/reconciliations/{reconciliation.id}/export/?scope=stage&stage_number=1"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reconciliation_exported",
                entity_type="reconciliation",
                entity_id=str(reconciliation.id),
            ).exists()
        )

    def test_export_all_writes_audit(self):
        self.create_message()
        reconciliation = self.create_reconciliation()

        self.authenticate_master()

        response = self.client.get(
            f"/api/reconciliations/{reconciliation.id}/export/?scope=all"
        )

        self.assertEqual(response.status_code, 200)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reconciliation_exported",
                entity_type="reconciliation",
                entity_id=str(reconciliation.id),
            ).exists()
        )

    def test_slave_cannot_create_reconciliation(self):
        self.authenticate_slave()

        response = self.client.post(
            "/api/reconciliations/",
            {
                "slave_company": self.slave.id,
                "period_start": self.today.isoformat(),
                "period_end": self.today.isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)