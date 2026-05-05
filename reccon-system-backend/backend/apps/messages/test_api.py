from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.attachments.models import Attachment
from apps.audit.models import AuditLog
from apps.companies.models import Company
from apps.messages.models import Message


User = get_user_model()


class MessagesApiTests(TestCase):
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

    def authenticate_slave(self):
        self.client.force_authenticate(user=self.slave_user)

    def authenticate_master(self):
        self.client.force_authenticate(user=self.master_admin)

    def test_slave_can_create_draft_and_audit_is_written(self):
        self.authenticate_slave()

        response = self.client.post(
            "/api/messages/drafts/",
            {
                "subject": "Draft API test",
                "text": "Draft body",
                "html": "Draft body",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Message.objects.count(), 1)

        message = Message.objects.get()
        self.assertEqual(message.status, Message.STATUS_DRAFT)
        self.assertEqual(message.created_by, self.slave_user)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="message_draft_created",
                entity_type="message",
                entity_id=str(message.id),
            ).exists()
        )

    def test_slave_can_update_draft_and_audit_is_written(self):
        self.authenticate_slave()

        draft = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_DRAFT,
            subject="Old subject",
            body="Old body",
            body_html="Old body",
        )

        response = self.client.patch(
            f"/api/messages/drafts/{draft.id}/",
            {
                "subject": "New subject",
                "text": "New body",
                "html": "New body",
                "audit": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        draft.refresh_from_db()
        self.assertEqual(draft.subject, "New subject")
        self.assertEqual(draft.body, "New body")

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="message_draft_updated",
                entity_type="message",
                entity_id=str(draft.id),
            ).exists()
        )

    def test_delete_draft_uses_soft_delete_and_audit_is_written(self):
        self.authenticate_slave()

        draft = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_DRAFT,
            subject="Draft to delete",
            body="Body",
        )

        response = self.client.delete(f"/api/messages/drafts/{draft.id}/")

        self.assertIn(response.status_code, [200, 204])

        draft.refresh_from_db()
        self.assertTrue(draft.is_deleted)
        self.assertEqual(draft.deleted_by, self.slave_user)
        self.assertEqual(draft.delete_reason, "draft deleted by user")

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="message_draft_deleted",
                entity_type="message",
                entity_id=str(draft.id),
            ).exists()
        )

    @patch("apps.messages.api.upload_fileobj")
    def test_add_attachment_to_draft_writes_audit(self, mock_upload_fileobj):
        self.authenticate_slave()
        mock_upload_fileobj.return_value = ("test/file.pdf", 11)

        draft = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_DRAFT,
            subject="Draft with file",
            body="Body",
        )

        file_obj = SimpleUploadedFile(
            "test.pdf",
            b"hello world",
            content_type="application/pdf",
        )

        response = self.client.post(
            f"/api/messages/drafts/{draft.id}/attachments/",
            {"files": file_obj},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Attachment.objects.count(), 1)

        attachment = Attachment.objects.get()
        self.assertEqual(attachment.message, draft)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="attachment_attached",
                entity_type="attachment",
                entity_id=str(attachment.id),
            ).exists()
        )

    @patch("apps.attachments.api.delete_object")
    def test_delete_attachment_from_draft_writes_audit(self, mock_delete_object):
        self.authenticate_slave()

        draft = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_DRAFT,
            subject="Draft with file",
            body="Body",
        )
        attachment = Attachment.objects.create(
            message=draft,
            storage_key="test/file.pdf",
            filename="test.pdf",
            content_type="application/pdf",
            size=11,
            status=Attachment.STATUS_ATTACHED,
        )

        response = self.client.delete(f"/api/attachments/{attachment.id}/")

        self.assertIn(response.status_code, [200, 204])
        self.assertFalse(Attachment.objects.filter(id=attachment.id).exists())

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="attachment_deleted",
                entity_type="attachment",
                entity_id=str(attachment.id),
            ).exists()
        )

    def test_send_draft_changes_status_and_writes_audit(self):
        self.authenticate_slave()

        draft = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_DRAFT,
            subject="Draft to send",
            body="Body",
        )

        response = self.client.post(f"/api/messages/drafts/{draft.id}/send/")

        self.assertEqual(response.status_code, 200)

        draft.refresh_from_db()
        self.assertEqual(draft.status, Message.STATUS_PENDING)
        self.assertTrue(draft.sender_number.startswith("O-"))

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="message_sent",
                entity_type="message",
                entity_id=str(draft.id),
            ).exists()
        )

    def test_slave_can_send_message_directly(self):
        self.authenticate_slave()

        response = self.client.post(
            "/api/messages/sent/compose/",
            {
                "subject": "Direct message",
                "text": "Body",
                "html": "Body",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)

        message = Message.objects.get(subject="Direct message")
        self.assertEqual(message.status, Message.STATUS_PENDING)
        self.assertTrue(message.sender_number.startswith("O-"))

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="message_sent",
                entity_type="message",
                entity_id=str(message.id),
            ).exists()
        )

    def test_master_can_open_inbox_message_and_audit_is_written(self):
        message = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_PENDING,
            subject="Incoming",
            body="Body",
        )

        self.authenticate_master()

        response = self.client.post(f"/api/messages/inbox/{message.id}/open/")

        self.assertEqual(response.status_code, 200)

        message.refresh_from_db()
        self.assertEqual(message.status, Message.STATUS_READ)
        self.assertIsNotNone(message.read_at)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="message_opened",
                entity_type="message",
                entity_id=str(message.id),
            ).exists()
        )

    def test_master_can_confirm_message_and_audit_is_written(self):
        message = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_READ,
            subject="Incoming",
            body="Body",
        )

        self.authenticate_master()

        response = self.client.post(
            f"/api/messages/inbox/{message.id}/confirm/",
            {"receiver_number": "I-000001"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        message.refresh_from_db()
        self.assertEqual(message.status, Message.STATUS_CONFIRMED)
        self.assertEqual(message.receiver_number, "I-000001")
        self.assertEqual(message.confirmed_by, self.master_admin)

        self.assertTrue(
            AuditLog.objects.filter(
                event_type="message_confirmed",
                entity_type="message",
                entity_id=str(message.id),
            ).exists()
        )

    def test_master_cannot_create_draft(self):
        self.authenticate_master()

        response = self.client.post(
            "/api/messages/drafts/",
            {
                "subject": "Forbidden",
                "text": "Body",
                "html": "Body",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 403)

    def test_slave_cannot_open_inbox_message(self):
        message = Message.objects.create(
            sender_company=self.slave,
            receiver_company=self.master,
            created_by=self.slave_user,
            status=Message.STATUS_PENDING,
            subject="Incoming",
            body="Body",
        )

        self.authenticate_slave()

        response = self.client.post(f"/api/messages/inbox/{message.id}/open/")

        self.assertEqual(response.status_code, 403)