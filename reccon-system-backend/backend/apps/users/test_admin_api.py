from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.companies.models import Company


User = get_user_model()


class AdminUsersApiTests(TestCase):
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
        self.other_slave = Company.objects.create(
            name="Other Slave",
            company_type=Company.TYPE_SLAVE,
            master_partner=self.master,
        )

        self.master_admin = User.objects.create_user(
            username="master_admin",
            password="testpass123",
            company=self.master,
            is_company_admin=True,
        )
        self.slave_admin = User.objects.create_user(
            username="slave_admin",
            password="testpass123",
            company=self.slave,
            is_company_admin=True,
        )
        self.regular_user = User.objects.create_user(
            username="regular_user",
            password="testpass123",
            company=self.slave,
            is_company_admin=False,
        )
        self.other_user = User.objects.create_user(
            username="other_user",
            password="testpass123",
            company=self.other_slave,
            is_company_admin=False,
        )

    def test_admin_can_create_user_and_audit_is_written(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.post(
            "/api/admin/users/",
            {
                "companyId": self.slave.id,
                "login": "new_user",
                "password": "newpass123",
                "roleKey": "user",
                "email": "new@example.com",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        user = User.objects.get(username="new_user")
        self.assertEqual(user.company, self.slave)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="user_created",
                entity_type="user",
                entity_id=str(user.id),
            ).exists()
        )

    def test_admin_can_update_user_and_audit_is_written(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.patch(
            f"/api/admin/users/{self.regular_user.id}/",
            {
                "companyId": self.slave.id,
                "login": "regular_user_updated",
                "password": "********",
                "roleKey": "admin",
                "email": "updated@example.com",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.regular_user.refresh_from_db()
        self.assertEqual(self.regular_user.username, "regular_user_updated")
        self.assertTrue(self.regular_user.is_company_admin)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="user_updated",
                entity_type="user",
                entity_id=str(self.regular_user.id),
            ).exists()
        )

    def test_admin_can_toggle_user_status_and_audit_is_written(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.post(
            f"/api/admin/users/{self.regular_user.id}/toggle-status/"
        )

        self.assertEqual(response.status_code, 200)

        self.regular_user.refresh_from_db()
        self.assertFalse(self.regular_user.is_active)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="user_status_changed",
                entity_type="user",
                entity_id=str(self.regular_user.id),
            ).exists()
        )

    def test_regular_user_cannot_access_admin_users(self):
        self.client.force_authenticate(user=self.regular_user)

        response = self.client.get("/api/admin/users/")

        self.assertEqual(response.status_code, 403)

    def test_slave_admin_cannot_edit_user_from_other_company(self):
        self.client.force_authenticate(user=self.slave_admin)

        response = self.client.patch(
            f"/api/admin/users/{self.other_user.id}/",
            {
                "companyId": self.other_slave.id,
                "login": "hacked_user",
                "password": "********",
                "roleKey": "user",
                "email": "hacked@example.com",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 404)