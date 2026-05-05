from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from apps.audit.models import AuditLog
from apps.audit.service import build_audit_payload, write_audit
from apps.companies.models import Company


User = get_user_model()


class AuditServiceTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.company = Company.objects.create(
            name="Audit Company",
            company_type=Company.TYPE_MASTER,
        )
        self.user = User.objects.create_user(
            username="audit_user",
            password="testpass123",
            company=self.company,
        )

    def test_build_audit_payload_without_request(self):
        payload = build_audit_payload(
            old_values={"status": "draft"},
            new_values={"status": "pending"},
            reason="message sent",
        )

        self.assertEqual(payload["old_values"], {"status": "draft"})
        self.assertEqual(payload["new_values"], {"status": "pending"})
        self.assertEqual(payload["reason"], "message sent")
        self.assertNotIn("request", payload)

    def test_build_audit_payload_with_request_metadata(self):
        request = self.factory.patch(
            "/api/messages/drafts/1/",
            HTTP_USER_AGENT="UnitTestBrowser",
            REMOTE_ADDR="127.0.0.1",
        )

        payload = build_audit_payload(
            old_values={"subject": "Old"},
            new_values={"subject": "New"},
            reason="draft updated",
            request=request,
        )

        self.assertEqual(payload["request"]["method"], "PATCH")
        self.assertEqual(payload["request"]["path"], "/api/messages/drafts/1/")
        self.assertEqual(payload["request"]["ip_address"], "127.0.0.1")
        self.assertEqual(payload["request"]["user_agent"], "UnitTestBrowser")

    def test_write_audit_creates_log_with_structured_payload(self):
        request = self.factory.post(
            "/api/messages/drafts/",
            HTTP_USER_AGENT="UnitTestBrowser",
            REMOTE_ADDR="127.0.0.1",
        )

        log = write_audit(
            actor=self.user,
            event_type="message_draft_created",
            entity_type="message",
            entity_id=10,
            old_values={},
            new_values={"status": "draft", "subject": "Test"},
            reason="draft created by user",
            request=request,
        )

        self.assertEqual(AuditLog.objects.count(), 1)
        self.assertEqual(log.actor, self.user)
        self.assertEqual(log.event_type, "message_draft_created")
        self.assertEqual(log.entity_type, "message")
        self.assertEqual(log.entity_id, "10")
        self.assertEqual(log.payload["old_values"], {})
        self.assertEqual(log.payload["new_values"]["status"], "draft")
        self.assertEqual(log.payload["reason"], "draft created by user")
        self.assertEqual(log.payload["request"]["method"], "POST")

    def test_write_audit_keeps_explicit_payload_for_backward_compatibility(self):
        log = write_audit(
            actor=self.user,
            event_type="legacy_event",
            entity_type="message",
            entity_id=1,
            payload={"status": "pending"},
        )

        self.assertEqual(log.payload, {"status": "pending"})