from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.companies.models import Company
from apps.messages.models import Message, MessageNumberCounter
from apps.messages.numbering import (
    generate_next_sender_number,
    get_next_receiver_number_suggestion,
    register_receiver_number,
    validate_receiver_number_format,
    validate_sender_number_format,
)


User = get_user_model()


class MessageTestDataMixin:
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


class MessageNumberingTests(MessageTestDataMixin, TestCase):
    def test_first_sender_number_is_o_000001(self):
        number = generate_next_sender_number(self.slave)

        self.assertEqual(number, "O-000001")
        self.assertTrue(validate_sender_number_format(number))

    def test_sender_number_increments(self):
        first = generate_next_sender_number(self.slave)
        second = generate_next_sender_number(self.slave)

        self.assertEqual(first, "O-000001")
        self.assertEqual(second, "O-000002")

    def test_first_receiver_number_suggestion_is_i_000001(self):
        number = get_next_receiver_number_suggestion(self.master)

        self.assertEqual(number, "I-000001")
        self.assertTrue(validate_receiver_number_format(number))

    def test_register_receiver_number_advances_counter(self):
        register_receiver_number(self.master, "I-000005")

        next_number = get_next_receiver_number_suggestion(self.master)

        self.assertEqual(next_number, "I-000006")

    def test_register_lower_receiver_number_does_not_decrease_counter(self):
        register_receiver_number(self.master, "I-000005")
        register_receiver_number(self.master, "I-000003")

        next_number = get_next_receiver_number_suggestion(self.master)

        self.assertEqual(next_number, "I-000006")

    def test_receiver_number_format_validation(self):
        self.assertTrue(validate_receiver_number_format("I-000001"))
        self.assertFalse(validate_receiver_number_format("I-1"))
        self.assertFalse(validate_receiver_number_format("O-000001"))
        self.assertFalse(validate_receiver_number_format("ABC"))

    def test_sender_counter_is_company_specific(self):
        other_master = Company.objects.create(
            name="Other Master",
            company_type=Company.TYPE_MASTER,
        )
        other_slave = Company.objects.create(
            name="Other Slave",
            company_type=Company.TYPE_SLAVE,
            master_partner=other_master,
        )

        self.assertEqual(generate_next_sender_number(self.slave), "O-000001")
        self.assertEqual(generate_next_sender_number(other_slave), "O-000001")

        self.assertEqual(
            MessageNumberCounter.objects.filter(
                counter_type=MessageNumberCounter.TYPE_SENDER
            ).count(),
            2,
        )


class MessageModelTraceabilityTests(MessageTestDataMixin, TestCase):
    def test_message_stores_created_by_user(self):
        message = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_DRAFT,
            subject="Test draft",
            body="Draft body",
        )

        self.assertEqual(message.created_by, self.slave_user)
        self.assertEqual(message.status, Message.STATUS_DRAFT)

    def test_message_stores_confirmed_by_user(self):
        message = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_READ,
            subject="Test message",
            body="Message body",
        )

        message.status = Message.STATUS_CONFIRMED
        message.receiver_number = "I-000001"
        message.confirmed_at = timezone.now()
        message.confirmed_by = self.master_user
        message.save(
            update_fields=[
                "status",
                "receiver_number",
                "confirmed_at",
                "confirmed_by",
                "updated_at",
            ]
        )

        message.refresh_from_db()

        self.assertEqual(message.status, Message.STATUS_CONFIRMED)
        self.assertEqual(message.confirmed_by, self.master_user)
        self.assertEqual(message.receiver_number, "I-000001")
        self.assertIsNotNone(message.confirmed_at)

    def test_soft_delete_fields_hide_draft_from_active_queryset(self):
        message = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_DRAFT,
            subject="Draft to delete",
            body="Draft body",
        )

        message.is_deleted = True
        message.deleted_at = timezone.now()
        message.deleted_by = self.slave_user
        message.delete_reason = "draft deleted by user"
        message.save(
            update_fields=[
                "is_deleted",
                "deleted_at",
                "deleted_by",
                "delete_reason",
                "updated_at",
            ]
        )

        message.refresh_from_db()

        self.assertTrue(message.is_deleted)
        self.assertEqual(message.deleted_by, self.slave_user)
        self.assertEqual(message.delete_reason, "draft deleted by user")
        self.assertFalse(
            Message.objects.filter(id=message.id, is_deleted=False).exists()
        )

    def test_unconfirmed_statuses_are_pending_and_read(self):
        pending = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_PENDING,
            subject="Pending",
        )
        read = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_READ,
            subject="Read",
        )
        confirmed = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_CONFIRMED,
            subject="Confirmed",
        )

        unconfirmed = Message.objects.filter(
            status__in=[Message.STATUS_PENDING, Message.STATUS_READ]
        )

        self.assertIn(pending, unconfirmed)
        self.assertIn(read, unconfirmed)
        self.assertNotIn(confirmed, unconfirmed)