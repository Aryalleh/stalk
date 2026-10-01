from django.conf import settings
from django.db import models
from django.db.models import Q

from . import normalize as n


class Contact(models.Model):
    first_name = models.CharField("نام", max_length=100, blank=True)
    last_name = models.CharField("نام خانوادگی", max_length=100, blank=True)
    father_name = models.CharField("نام پدر", max_length=100, blank=True)
    national_code = models.CharField(
        "کد ملی", max_length=10, blank=True, validators=[n.validate_national_code]
    )

    phone = models.CharField("شماره تماس", max_length=20, blank=True, validators=[n.validate_phone])
    phone2 = models.CharField("شماره تماس دوم", max_length=20, blank=True, validators=[n.validate_phone])
    father_phone = models.CharField("شماره پدر", max_length=20, blank=True, validators=[n.validate_phone])

    telegram_id = models.CharField("آیدی تلگرام", max_length=100, blank=True)
    instagram_id = models.CharField("آیدی اینستاگرام", max_length=100, blank=True)
    twitter_id = models.CharField("آیدی توییتر (X)", max_length=100, blank=True)
    bale_id = models.CharField("آیدی بله", max_length=100, blank=True)

    postal_code = models.CharField(
        "کد پستی", max_length=10, blank=True, validators=[n.validate_postal_code]
    )
    address = models.TextField("آدرس", blank=True)
    notes = models.TextField("یادداشت", blank=True)

    created_at = models.DateTimeField("تاریخ ایجاد", auto_now_add=True)
    updated_at = models.DateTimeField("آخرین ویرایش", auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="ایجادکننده",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="+",
    )

    # Fields whose changes are recorded in ChangeLog.
    TRACKED_FIELDS = [
        "first_name", "last_name", "father_name", "national_code",
        "phone", "phone2", "father_phone",
        "telegram_id", "instagram_id", "twitter_id", "bale_id",
        "postal_code", "address", "notes",
    ]
    PHONE_FIELDS = ["phone", "phone2", "father_phone"]
    HANDLE_FIELDS = ["telegram_id", "instagram_id", "twitter_id", "bale_id"]

    class Meta:
        verbose_name = "مخاطب"
        verbose_name_plural = "مخاطبین"
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["national_code"],
                condition=~Q(national_code=""),
                name="unique_national_code_when_set",
                violation_error_message="مخاطبی با این کد ملی قبلاً ثبت شده است.",
            )
        ]

    def __str__(self):
        name = f"{self.first_name} {self.last_name}".strip()
        return name or self.phone or f"مخاطب #{self.pk}"

    def normalize(self):
        for f in self.PHONE_FIELDS:
            setattr(self, f, n.normalize_phone(getattr(self, f)))
        for f in self.HANDLE_FIELDS:
            setattr(self, f, n.normalize_handle(getattr(self, f)))
        self.national_code = n.normalize_digits(self.national_code)
        self.postal_code = n.normalize_digits(self.postal_code)

    def clean_fields(self, exclude=None):
        # Normalize before validators run, so "۰۹۱۲ ۱۲۳ ۴۵۶۷" or "@user" are accepted.
        self.normalize()
        super().clean_fields(exclude)

    def save(self, *args, **kwargs):
        self.normalize()
        super().save(*args, **kwargs)

    @classmethod
    def field_label(cls, name):
        return str(cls._meta.get_field(name).verbose_name)


class FieldDefinition(models.Model):
    """A user-defined extra field type (e.g. ایمیل، واتساپ، شغل)."""

    name = models.CharField("عنوان فیلد", max_length=100, unique=True)

    class Meta:
        verbose_name = "نوع فیلد اضافه"
        verbose_name_plural = "انواع فیلد اضافه"
        ordering = ["name"]

    def __str__(self):
        return self.name


class ExtraValue(models.Model):
    contact = models.ForeignKey(
        Contact, verbose_name="مخاطب", on_delete=models.CASCADE, related_name="extra_values"
    )
    field = models.ForeignKey(FieldDefinition, verbose_name="فیلد", on_delete=models.PROTECT)
    value = models.TextField("مقدار", blank=True)

    class Meta:
        verbose_name = "اطلاعات اضافه"
        verbose_name_plural = "اطلاعات اضافه"
        constraints = [
            models.UniqueConstraint(fields=["contact", "field"], name="unique_extra_field_per_contact")
        ]

    def __str__(self):
        return f"{self.field}: {self.value}"

    @property
    def log_key(self):
        return f"extra:{self.field_id}"


class ChangeLog(models.Model):
    CREATE, UPDATE, DELETE = "create", "update", "delete"
    ACTIONS = [(CREATE, "ایجاد"), (UPDATE, "ویرایش"), (DELETE, "حذف")]
    CONTACT_KEY = "__contact__"  # field_name used for whole-contact create/delete rows

    # No DB constraint: logs must outlive the contact they describe.
    contact = models.ForeignKey(
        Contact,
        verbose_name="مخاطب",
        on_delete=models.DO_NOTHING,
        db_constraint=False,
        related_name="change_logs",
    )
    contact_repr = models.CharField("نام مخاطب (در لحظه ثبت)", max_length=255)
    field_name = models.CharField("کلید فیلد", max_length=100, db_index=True)
    field_label = models.CharField("فیلد", max_length=150)
    action = models.CharField("عملیات", max_length=10, choices=ACTIONS)
    old_value = models.TextField("مقدار قبلی", blank=True)
    new_value = models.TextField("مقدار جدید", blank=True)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="کاربر",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    changed_at = models.DateTimeField("زمان تغییر", auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "سابقه تغییر"
        verbose_name_plural = "سوابق تغییرات"
        ordering = ["-changed_at", "-id"]
        indexes = [models.Index(fields=["contact", "field_name", "changed_at"])]

    def __str__(self):
        return f"{self.contact_repr} / {self.field_label}"
