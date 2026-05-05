from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.companies.models import Company


User = get_user_model()


class AuditApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.company = Company.objects.create(
            name="Company",
            company_type=Company.TYPE_MASTER,
        )
        self.other_company = Company.objects.create(
            name="Other Company",
            company_type=Company.TYPE_MASTER,
        )

        self.admin = User.objects.create_user(
            username="admin",
            password="testpass123",
            company=self.company,
            is_company_admin=True,
        )
        self.regular_user = User.objects.create_user(
            username="regular",
            password="testpass123",
            company=self.company,
            is_company_admin=False,
        )
        self.other_admin = User.objects.create_user(
            username="other_admin",
            password="testpass123",
            company=self.other_company,
            is_company_admin=True,
        )

        self.company_log = AuditLog.objects.create(
            actor=self.admin,
            event_type="message_sent",
            entity_type="message",
            entity_id="1",
            payload={"new_values": {"status": "pending"}},
        )
        self.other_company_log = AuditLog.objects.create(
            actor=self.other_admin,
            event_type="message_sent",
            entity_type="message",
            entity_id="2",
            payload={"new_values": {"status": "pending"}},
        )

    def test_admin_can_view_own_company_audit(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.get("/api/audit/")

        self.assertEqual(response.status_code, 200)

        ids = [item["id"] for item in response.data]
        self.assertIn(self.company_log.id, ids)
        self.assertNotIn(self.other_company_log.id, ids)

    def test_regular_user_cannot_view_audit(self):
        self.client.force_authenticate(user=self.regular_user)

        response = self.client.get("/api/audit/")

        self.assertEqual(response.status_code, 403)

    def test_audit_filter_by_event_type(self):
        self.client.force_authenticate(user=self.admin)

        AuditLog.objects.create(
            actor=self.admin,
            event_type="message_confirmed",
            entity_type="message",
            entity_id="3",
            payload={},
        )

        response = self.client.get("/api/audit/?event_type=message_confirmed")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["event_type"], "message_confirmed")

    def test_audit_filter_by_entity_id(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.get("/api/audit/?entity_id=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["entity_id"], "1")