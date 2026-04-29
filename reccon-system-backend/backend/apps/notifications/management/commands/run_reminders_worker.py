import logging
import time

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.notifications.service import process_all_company_reminders

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Runs periodic reminder delivery for inside notifications and email reminders."

    def add_arguments(self, parser):
        parser.add_argument(
            "--once",
            action="store_true",
            help="Run one reminder iteration and exit.",
        )

    def handle(self, *args, **options):
        run_once = options["once"]
        sleep_seconds = int(getattr(settings, "REMINDER_WORKER_SLEEP_SECONDS", 60))

        self.stdout.write(self.style.SUCCESS("Reminder worker started."))

        while True:
            results = process_all_company_reminders()
            total_inside = sum(item["inside_sent"] for item in results)
            total_email = sum(item["email_sent"] for item in results)
            self.stdout.write(
                f"Processed {len(results)} companies. "
                f"Inside sent: {total_inside}. Email sent: {total_email}."
            )

            if run_once:
                break

            logger.info(
                "Reminder worker sleeping for %s seconds after processing %s companies.",
                sleep_seconds,
                len(results),
            )
            time.sleep(sleep_seconds)
