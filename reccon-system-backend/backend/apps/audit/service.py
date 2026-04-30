from apps.audit.models import AuditLog


def get_request_meta(request):
    if request is None:
        return {}

    return {
        "ip_address": request.META.get("REMOTE_ADDR", ""),
        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
        "method": request.method,
        "path": request.get_full_path(),
    }


def build_audit_payload(
    *,
    old_values=None,
    new_values=None,
    reason="",
    extra=None,
    request=None,
):
    payload = {
        "old_values": old_values or {},
        "new_values": new_values or {},
        "reason": reason or "",
    }

    request_meta = get_request_meta(request)
    if request_meta:
        payload["request"] = request_meta

    if extra:
        payload.update(extra)

    return payload


def write_audit(
    *,
    actor,
    event_type,
    entity_type,
    entity_id="",
    payload=None,
    old_values=None,
    new_values=None,
    reason="",
    extra=None,
    request=None,
):
    if payload is None:
        payload = build_audit_payload(
            old_values=old_values,
            new_values=new_values,
            reason=reason,
            extra=extra,
            request=request,
        )

    return AuditLog.objects.create(
        actor=actor,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else "",
        payload=payload or {},
    )