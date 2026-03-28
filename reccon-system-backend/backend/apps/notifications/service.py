import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from apps.companies.models import Company
from apps.messages.models import Message
from apps.notifications.models import CompanyReminderSettings, Notification, UserReminderDispatch

logger = logging.getLogger(__name__)

REMINDER_EMAIL_SUBJECT = "Reccon Напоминание"
REMINDER_TITLE = "Напоминание"
REMINDER_MESSAGE_TEMPLATE = "Здравствуйте!\nУ Вас {count} неподтверждённых сообщений.\nНе нужно отвечать на это письмо."

def create_notification(
    *,
    user,
    notif_type=Notification.TYPE_SYSTEM,
    title="",
    message="",
    payload=None,
    status=Notification.STATUS_NEW,
):
    return Notification.objects.create(
        user=user,
        notif_type=notif_type,
        status=status,
        title=title,
        message=message,
        payload=payload or {},
    )


def get_unconfirmed_count_for_company(company):
    if company.company_type != Company.TYPE_MASTER:
        return 0

    return Message.objects.filter(
        receiver_company=company,
        status__in=[Message.STATUS_PENDING, Message.STATUS_READ],
    ).count()


def get_or_create_dispatch(*, user, company, channel):
    dispatch, _ = UserReminderDispatch.objects.get_or_create(
        user=user,
        company=company,
        channel=channel,
    )
    return dispatch


def is_dispatch_due(*, dispatch, interval_minutes, now=None):
    now = now or timezone.now()
    if dispatch.last_sent_at is None:
        return True
    return dispatch.last_sent_at + timedelta(minutes=interval_minutes) <= now


def mark_dispatch_sent(dispatch, now=None):
    dispatch.last_sent_at = now or timezone.now()
    dispatch.save(update_fields=["last_sent_at", "updated_at"])


def build_reminder_message(count):
    return REMINDER_MESSAGE_TEMPLATE.format(count=count)


def create_inside_reminder(*, user, company, count, now=None):
    now = now or timezone.now()
    dispatch = get_or_create_dispatch(
        user=user,
        company=company,
        channel=UserReminderDispatch.CHANNEL_INSIDE,
    )
    settings_obj, _ = CompanyReminderSettings.objects.get_or_create(company=company)
    if not is_dispatch_due(dispatch=dispatch, interval_minutes=settings_obj.interval_minutes, now=now):
        return False

    create_notification(
        user=user,
        notif_type=Notification.TYPE_REMINDER,
        title=REMINDER_TITLE,
        message=build_reminder_message(count),
        payload={
            "kind": "unconfirmed_messages",
            "count": count,
            "channel": UserReminderDispatch.CHANNEL_INSIDE,
            "company_id": company.id,
        },
    )
    mark_dispatch_sent(dispatch, now=now)
    return True


def send_email_reminder(*, user, company, count, now=None):
    if not user.email:
        return False

    now = now or timezone.now()
    dispatch = get_or_create_dispatch(
        user=user,
        company=company,
        channel=UserReminderDispatch.CHANNEL_EMAIL,
    )
    settings_obj, _ = CompanyReminderSettings.objects.get_or_create(company=company)
    if not is_dispatch_due(dispatch=dispatch, interval_minutes=settings_obj.interval_minutes, now=now):
        return False

    send_mail(
        subject=REMINDER_EMAIL_SUBJECT,
        message=build_reminder_message(count),
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
        recipient_list=[user.email],
        fail_silently=False,
    )
    mark_dispatch_sent(dispatch, now=now)
    return True


def process_company_reminders(company, now=None):
    now = now or timezone.now()
    settings_obj, _ = CompanyReminderSettings.objects.get_or_create(company=company)
    stats = {
        "company": company.name,
        "inside_sent": 0,
        "email_sent": 0,
        "skipped_users": 0,
        "unconfirmed_count": 0,
    }

    if not settings_obj.enabled:
        return stats

    unconfirmed_count = get_unconfirmed_count_for_company(company)
    stats["unconfirmed_count"] = unconfirmed_count
    if unconfirmed_count <= 0:
        return stats

    users = company.users.filter(is_active=True).order_by("id")
    for user in users:
        sent_any = False

        if settings_obj.send_inside:
            try:
                if create_inside_reminder(user=user, company=company, count=unconfirmed_count, now=now):
                    stats["inside_sent"] += 1
                    sent_any = True
            except Exception:
                logger.exception(
                    "Failed to create inside reminder for user_id=%s company_id=%s",
                    user.id,
                    company.id,
                )

        if settings_obj.send_email and (user.email or "").strip():
            try:
                if send_email_reminder(user=user, company=company, count=unconfirmed_count, now=now):
                    stats["email_sent"] += 1
                    sent_any = True
            except Exception:
                logger.exception(
                    "Failed to send reminder email for user_id=%s company_id=%s",
                    user.id,
                    company.id,
                )

        if not sent_any:
            stats["skipped_users"] += 1

    return stats


def process_all_company_reminders(now=None):
    now = now or timezone.now()
    companies = Company.objects.filter(
        is_active=True,
        company_type=Company.TYPE_MASTER,
        reminder_settings__enabled=True,
    ).distinct()

    results = []
    for company in companies:
        results.append(process_company_reminders(company, now=now))
    return results
