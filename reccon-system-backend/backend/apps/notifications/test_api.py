from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.companies.models import Company
from apps.messages.models import Message
from apps.notifications.models import CompanyReminderSettings


User = get_user_model()


class NotificationsApiTests(TestCase):
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
        self.master_user = User.objects.create_user(
            username="master_user",
            password="testpass123",
            company=self.master,
            is_company_admin=False,
        )
        self.slave_admin = User.objects.create_user(
            username="slave_admin",
            password="testpass123",
            company=self.slave,
            is_company_admin=True,
        )

    def test_unread_count_counts_pending_and_read_messages_for_master(self):
        Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            status=Message.STATUS_PENDING,
            subject="Pending",
        )
        Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            status=Message.STATUS_READ,
            subject="Read",
        )
        Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            status=Message.STATUS_CONFIRMED,
            subject="Confirmed",
        )

        self.client.force_authenticate(user=self.master_user)

        response = self.client.get("/api/notifications/unread-count/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["unread_count"], 2)

    def test_master_admin_can_get_reminder_settings(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.get("/api/admin/reminder-settings/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("enabled", response.data["data"])
        self.assertIn("channels", response.data["data"])

    def test_master_admin_can_update_reminder_settings_and_audit_is_written(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.put(
            "/api/admin/reminder-settings/",
            {
                "enabled": True,
                "intervalLabel": "1 час",
                "channels": {
                    "inside": True,
                    "email": True,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        settings = CompanyReminderSettings.objects.get(company=self.master)
        self.assertTrue(settings.enabled)
        self.assertEqual(settings.interval_minutes, 60)
        self.assertTrue(settings.send_inside)
        self.assertTrue(settings.send_email)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="reminder_settings_updated",
                entity_type="company_reminder_settings",
                entity_id=str(settings.id),
            ).exists()
        )

    def test_regular_user_cannot_update_reminder_settings(self):
        self.client.force_authenticate(user=self.master_user)

        response = self.client.put(
            "/api/admin/reminder-settings/",
            {
                "enabled": True,
                "intervalLabel": "1 час",
                "channels": {
                    "inside": True,
                    "email": True,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_slave_admin_cannot_update_reminder_settings(self):
        self.client.force_authenticate(user=self.slave_admin)

        response = self.client.put(
            "/api/admin/reminder-settings/",
            {
                "enabled": True,
                "intervalLabel": "1 час",
                "channels": {
                    "inside": True,
                    "email": True,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_reminder_settings_rejects_disabled_all_channels(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.put(
            "/api/admin/reminder-settings/",
            {
                "enabled": True,
                "intervalLabel": "1 час",
                "channels": {
                    "inside": False,
                    "email": False,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)