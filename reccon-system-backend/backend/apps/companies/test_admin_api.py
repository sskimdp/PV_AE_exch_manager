from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.companies.models import Company


User = get_user_model()


class AdminCompaniesApiTests(TestCase):
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
        self.slave_admin = User.objects.create_user(
            username="slave_admin",
            password="testpass123",
            company=self.slave,
            is_company_admin=True,
        )

    def test_master_admin_can_create_company_and_audit_is_written(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.post(
            "/api/admin/companies/",
            {
                "name": "New Slave Company",
                "adminLogin": "new_slave_admin",
                "adminPassword": "newpass123",
                "adminEmail": "newslave@example.com",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        company = Company.objects.get(name="New Slave Company")
        self.assertEqual(company.company_type, Company.TYPE_SLAVE)
        self.assertEqual(company.master_partner, self.master)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="company_created",
                entity_type="company",
                entity_id=str(company.id),
            ).exists()
        )

    def test_master_admin_can_update_company_and_audit_is_written(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.patch(
            f"/api/admin/companies/{self.slave.id}/",
            {
                "name": "Updated Slave Company",
                "adminLogin": "slave_admin",
                "adminPassword": "********",
                "adminEmail": "updated@example.com",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.slave.refresh_from_db()
        self.assertEqual(self.slave.name, "Updated Slave Company")

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="company_updated",
                entity_type="company",
                entity_id=str(self.slave.id),
            ).exists()
        )

    def test_master_admin_can_toggle_company_status_and_audit_is_written(self):
        self.client.force_authenticate(user=self.master_admin)

        response = self.client.post(
            f"/api/admin/companies/{self.slave.id}/toggle-status/"
        )

        self.assertEqual(response.status_code, 200)

        self.slave.refresh_from_db()
        self.assertFalse(self.slave.is_active)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="company_status_changed",
                entity_type="company",
                entity_id=str(self.slave.id),
            ).exists()
        )

    def test_slave_admin_cannot_manage_companies(self):
        self.client.force_authenticate(user=self.slave_admin)

        response = self.client.get("/api/admin/companies/")

        self.assertEqual(response.status_code, 403)