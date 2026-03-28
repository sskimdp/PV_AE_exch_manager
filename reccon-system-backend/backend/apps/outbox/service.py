from apps.outbox.models import OutboxEvent


def write_outbox(*, event_type, payload=None, status=OutboxEvent.STATUS_NEW):
    return OutboxEvent.objects.create(
        event_type=event_type,
        payload=payload or {},
        status=status,
    )
