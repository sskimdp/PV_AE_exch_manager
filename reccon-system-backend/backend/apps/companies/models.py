from django.core.exceptions import ValidationError
from django.db import models


class Company(models.Model):
    TYPE_MASTER = "master"
    TYPE_SLAVE = "slave"
    TYPE_CHOICES = [(TYPE_MASTER, "Master"), (TYPE_SLAVE, "Slave")]

    name = models.CharField(max_length=255, unique=True)
    company_type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    is_active = models.BooleanField(default=True)

    master_partner = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="slave_partners",
        limit_choices_to={"company_type": TYPE_MASTER},
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]

    def clean(self):
        if self.company_type == self.TYPE_MASTER and self.master_partner_id is not None:
            raise ValidationError("Master company cannot have master_partner.")

        if self.company_type == self.TYPE_SLAVE:
            if self.master_partner is None:
                raise ValidationError("Slave company must have master_partner.")
            if self.master_partner.company_type != self.TYPE_MASTER:
                raise ValidationError("master_partner must be a master company.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.name
