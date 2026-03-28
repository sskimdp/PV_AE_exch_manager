from apps.audit.models import AuditLog


def write_audit(*, actor, event_type, entity_type, entity_id="", payload=None):
    return AuditLog.objects.create(
        actor=actor,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else "",
        payload=payload or {},
    )
