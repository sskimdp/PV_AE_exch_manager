from django.db import transaction
from django.db.models import Q
from django.core.exceptions import ValidationError
from django.utils import timezone
from apps.companies.models import Company
from apps.messages.models import Message
from apps.reconciliations.models import (
    Reconciliation,
    ReconciliationStage,
    ReconciliationStageItem,
)


def _get_messages_for_stage(
    *,
    master_company: Company,
    slave_company: Company,
    period_start,
    period_end,
    reconciliation: Reconciliation | None = None,
):
    """
    В этап попадают сообщения от slave к master:
    - либо отправленные в период сверки,
    - либо специально досланные в эту сверку.
    Draft не попадает.
    """
    queryset = Message.objects.filter(
        sender_company=slave_company,
        receiver_company=master_company,
    ).exclude(status=Message.STATUS_DRAFT)

    period_filter = Q(
        created_at__date__gte=period_start,
        created_at__date__lte=period_end,
    )

    if reconciliation is not None:
        queryset = queryset.filter(
            period_filter | Q(late_send_reconciliation_id=reconciliation.id)
        )
    else:
        queryset = queryset.filter(period_filter)

    return queryset.distinct().order_by("created_at", "id")


def _create_stage_items(*, stage: ReconciliationStage, messages):
    items = []
    for msg in messages:
        items.append(
            ReconciliationStageItem(
                stage=stage,
                message=msg,
                subject_snapshot=msg.subject,
                status_snapshot=msg.status,
                sent_at_snapshot=msg.created_at,
                confirmed_at_snapshot=msg.confirmed_at,
                confirmed_by_slave=False,
                confirmed_by_slave_at=None,
            )
        )

    if items:
        ReconciliationStageItem.objects.bulk_create(items)

    return items


@transaction.atomic
def create_reconciliation_with_first_stage(
    *,
    created_by,
    master_company: Company,
    slave_company: Company,
    period_start,
    period_end,
):
    if not created_by.company:
        raise ValidationError("User must belong to a company.")

    if created_by.company_id != master_company.id:
        raise ValidationError("Creator must belong to master company.")

    if master_company.company_type != "master":
        raise ValidationError("master_company must have type 'master'.")

    if slave_company.company_type != "slave":
        raise ValidationError("slave_company must have type 'slave'.")

    slave_master_partner_id = getattr(slave_company, "master_partner_id", None)
    if slave_master_partner_id and slave_master_partner_id != master_company.id:
        raise ValidationError("This slave company is linked to another master company.")

    if period_start > period_end:
        raise ValidationError("period_start cannot be greater than period_end.")

    duplicate_exists = Reconciliation.objects.filter(
        master_company=master_company,
        slave_company=slave_company,
        period_start=period_start,
        period_end=period_end,
        status=Reconciliation.STATUS_ACTIVE,
    ).exists()

    if duplicate_exists:
        raise ValidationError(
            "An active reconciliation for this company and period already exists."
        )

    reconciliation = Reconciliation.objects.create(
        master_company=master_company,
        slave_company=slave_company,
        period_start=period_start,
        period_end=period_end,
        status=Reconciliation.STATUS_ACTIVE,
        created_by=created_by,
    )

    stage = ReconciliationStage.objects.create(
        reconciliation=reconciliation,
        stage_number=1,
        status=ReconciliationStage.STATUS_ACTIVE,
    )

    messages = _get_messages_for_stage(
        master_company=master_company,
        slave_company=slave_company,
        period_start=period_start,
        period_end=period_end,
        reconciliation=reconciliation,
    )

    _create_stage_items(stage=stage, messages=messages)

    return reconciliation


@transaction.atomic
def create_next_stage(*, reconciliation: Reconciliation, created_by):
    if not created_by.company:
        raise ValidationError("User must belong to a company.")

    if created_by.company_id != reconciliation.master_company_id:
        raise ValidationError("Only master company can start a new stage.")

    if reconciliation.status != Reconciliation.STATUS_ACTIVE:
        raise ValidationError("Only active reconciliations can create a new stage.")

    current_stage = reconciliation.current_stage
    if not current_stage:
        raise ValidationError("There is no active stage.")

    if not current_stage.all_items_confirmed_by_slave:
        raise ValidationError("Slave must confirm all messages before starting a new stage.")

    if current_stage.stage_number >= 10:
        raise ValidationError("Maximum number of stages is 10.")

    current_stage.status = ReconciliationStage.STATUS_FINISHED
    current_stage.finished_at = timezone.now()
    current_stage.save(update_fields=["status", "finished_at"])

    new_stage = ReconciliationStage.objects.create(
        reconciliation=reconciliation,
        stage_number=current_stage.stage_number + 1,
        status=ReconciliationStage.STATUS_ACTIVE,
    )

    messages = _get_messages_for_stage(
        master_company=reconciliation.master_company,
        slave_company=reconciliation.slave_company,
        period_start=reconciliation.period_start,
        period_end=reconciliation.period_end,
        reconciliation=reconciliation,
    )

    _create_stage_items(stage=new_stage, messages=messages)

    return new_stage


@transaction.atomic
def finish_reconciliation(*, reconciliation: Reconciliation, finished_by):
    if not finished_by.company:
        raise ValidationError("User must belong to a company.")

    if finished_by.company_id != reconciliation.master_company_id:
        raise ValidationError("Only master company can finish reconciliation.")

    if reconciliation.status != Reconciliation.STATUS_ACTIVE:
        raise ValidationError("Only active reconciliations can be finished.")

    current_stage = reconciliation.current_stage
    if not current_stage:
        raise ValidationError("There is no active stage.")

    if not current_stage.all_items_confirmed_by_slave:
        raise ValidationError("Slave must confirm all messages before finishing reconciliation.")

    now = timezone.now()

    current_stage.status = ReconciliationStage.STATUS_FINISHED
    current_stage.finished_at = now
    current_stage.save(update_fields=["status", "finished_at"])

    reconciliation.status = Reconciliation.STATUS_FINISHED
    reconciliation.finished_at = now
    reconciliation.save(update_fields=["status", "finished_at"])

    return reconciliation