import re

from django.db import transaction

from apps.messages.models import MessageNumberCounter


SENDER_PREFIX = "O"
RECEIVER_PREFIX = "I"

SENDER_NUMBER_RE = re.compile(r"^O-\d{6}$")
RECEIVER_NUMBER_RE = re.compile(r"^I-\d{6}$")


def format_sender_number(value: int) -> str:
    return f"{SENDER_PREFIX}-{value:06d}"


def format_receiver_number(value: int) -> str:
    return f"{RECEIVER_PREFIX}-{value:06d}"


@transaction.atomic
def generate_next_sender_number(company) -> str:
    counter, _ = MessageNumberCounter.objects.select_for_update().get_or_create(
        company=company,
        counter_type=MessageNumberCounter.TYPE_SENDER,
        defaults={"last_value": 0},
    )
    counter.last_value += 1
    counter.save(update_fields=["last_value"])
    return format_sender_number(counter.last_value)


def get_next_receiver_number_suggestion(company) -> str:
    counter, _ = MessageNumberCounter.objects.get_or_create(
        company=company,
        counter_type=MessageNumberCounter.TYPE_RECEIVER,
        defaults={"last_value": 0},
    )
    return format_receiver_number(counter.last_value + 1)


@transaction.atomic
def register_receiver_number(company, value: str) -> None:
    if not validate_receiver_number_format(value):
        raise ValueError("Invalid receiver number format")

    numeric_value = int(value.split("-")[1])

    counter, _ = MessageNumberCounter.objects.select_for_update().get_or_create(
        company=company,
        counter_type=MessageNumberCounter.TYPE_RECEIVER,
        defaults={"last_value": 0},
    )

    if numeric_value > counter.last_value:
        counter.last_value = numeric_value
        counter.save(update_fields=["last_value"])


def validate_receiver_number_format(value: str) -> bool:
    return bool(RECEIVER_NUMBER_RE.fullmatch(value))


def validate_sender_number_format(value: str) -> bool:
    return bool(SENDER_NUMBER_RE.fullmatch(value))