from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.companies.models import Company


class CompanyModelValidationTests(TestCase):
    def test_master_company_can_be_created_without_master_partner(self):
        company = Company.objects.create(
            name="Master Company",
            company_type=Company.TYPE_MASTER,
        )

        self.assertEqual(company.company_type, Company.TYPE_MASTER)
        self.assertIsNone(company.master_partner)
        self.assertTrue(company.is_active)

    def test_master_company_cannot_have_master_partner(self):
        master = Company.objects.create(
            name="Master Company",
            company_type=Company.TYPE_MASTER,
        )

        company = Company(
            name="Invalid Master",
            company_type=Company.TYPE_MASTER,
            master_partner=master,
        )

        with self.assertRaises(ValidationError):
            company.save()

    def test_slave_company_must_have_master_partner(self):
        company = Company(
            name="Slave Without Master",
            company_type=Company.TYPE_SLAVE,
        )

        with self.assertRaises(ValidationError):
            company.save()

    def test_slave_company_can_be_created_with_master_partner(self):
        master = Company.objects.create(
            name="Master Company",
            company_type=Company.TYPE_MASTER,
        )

        slave = Company.objects.create(
            name="Slave Company",
            company_type=Company.TYPE_SLAVE,
            master_partner=master,
        )

        self.assertEqual(slave.company_type, Company.TYPE_SLAVE)
        self.assertEqual(slave.master_partner, master)

    def test_slave_company_master_partner_must_be_master_company(self):
        master = Company.objects.create(
            name="Master Company",
            company_type=Company.TYPE_MASTER,
        )
        slave_partner = Company.objects.create(
            name="Valid Slave",
            company_type=Company.TYPE_SLAVE,
            master_partner=master,
        )

        invalid_slave = Company(
            name="Invalid Slave",
            company_type=Company.TYPE_SLAVE,
            master_partner=slave_partner,
        )

        with self.assertRaises(ValidationError):
            invalid_slave.save()