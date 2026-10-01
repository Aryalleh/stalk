from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .history import parse_jalali, snapshot
from .models import ChangeLog, Contact, ExtraValue, FieldDefinition
from .normalize import normalize_handle, normalize_phone, validate_national_code


class NormalizeTests(TestCase):
    def test_phone(self):
        for raw in ["+98 912 123 4567", "00989121234567", "۰۹۱۲۱۲۳۴۵۶۷", "9121234567", "0912-123-4567"]:
            self.assertEqual(normalize_phone(raw), "09121234567", raw)

    def test_handle(self):
        self.assertEqual(normalize_handle("@ali_r"), "ali_r")
        self.assertEqual(normalize_handle("https://instagram.com/ali_r/"), "ali_r")
        self.assertEqual(normalize_handle("t.me/ali_r"), "ali_r")

    def test_national_code(self):
        validate_national_code("0499370899")
        with self.assertRaises(ValidationError):
            validate_national_code("0499370898")
        with self.assertRaises(ValidationError):
            validate_national_code("1111111111")

    def test_full_clean_accepts_persian_digits(self):
        c = Contact(first_name="علی", national_code="۰۴۹۹۳۷۰۸۹۹", phone="۰۹۱۲ ۱۲۳ ۴۵۶۷")
        c.full_clean()
        self.assertEqual(c.national_code, "0499370899")
        self.assertEqual(c.phone, "09121234567")


class ChangeLogTests(TestCase):
    def logs(self, contact, field):
        return list(
            ChangeLog.objects.filter(contact_id=contact.pk, field_name=field)
            .order_by("id")
            .values_list("action", "old_value", "new_value")
        )

    def test_create_and_update_are_logged(self):
        c = Contact.objects.create(first_name="علی", phone="09121111111")
        c.phone = "09122222222"
        c.save()
        c.save()  # no-op save must not add rows
        self.assertEqual(
            self.logs(c, "phone"),
            [("create", "", "09121111111"), ("update", "09121111111", "09122222222")],
        )
        self.assertEqual(self.logs(c, "last_name"), [])

    def test_extra_values_logged(self):
        email = FieldDefinition.objects.get(name="ایمیل")
        c = Contact.objects.create(first_name="سارا")
        ev = ExtraValue.objects.create(contact=c, field=email, value="a@x.ir")
        ev.value = "b@x.ir"
        ev.save()
        ev.delete()
        self.assertEqual(
            self.logs(c, f"extra:{email.pk}"),
            [("create", "", "a@x.ir"), ("update", "a@x.ir", "b@x.ir"), ("delete", "b@x.ir", "")],
        )

    def test_logs_survive_contact_delete(self):
        c = Contact.objects.create(first_name="رضا", phone="09121111111")
        ExtraValue.objects.create(contact=c, field=FieldDefinition.objects.first(), value="x")
        pk = c.pk
        c.delete()
        self.assertTrue(ChangeLog.objects.filter(contact_id=pk, field_name=ChangeLog.CONTACT_KEY, action="delete").exists())
        self.assertTrue(ChangeLog.objects.filter(contact_id=pk, field_name="phone").exists())

    def test_snapshot_at_past_time(self):
        t0 = timezone.now()
        with mock.patch("django.utils.timezone.now", return_value=t0):
            c = Contact.objects.create(first_name="علی", phone="09121111111")
        with mock.patch("django.utils.timezone.now", return_value=t0 + timedelta(days=10)):
            c.phone = "09122222222"
            c.save()
        past = dict(snapshot(c.pk, t0 + timedelta(days=1))["fields"])
        now = dict(snapshot(c.pk, t0 + timedelta(days=11))["fields"])
        self.assertEqual(past["شماره تماس"], "09121111111")
        self.assertEqual(now["شماره تماس"], "09122222222")
        self.assertFalse(snapshot(c.pk, t0 - timedelta(days=1))["exists"])

    def test_parse_jalali(self):
        dt = timezone.localtime(parse_jalali("۱۴۰۵/۰۷/۰۹ ۱۴:۳۰"))
        self.assertEqual((dt.year, dt.month, dt.day, dt.hour, dt.minute), (2026, 10, 1, 14, 30))


class AdminTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("admin", "a@a.ir", "pass")
        self.client.force_login(self.user)

    def test_admin_edit_records_user_and_pages_render(self):
        url = reverse("admin:crm_contact_add")
        data = {
            "first_name": "علی", "last_name": "رضایی", "phone": "+989121234567",
            "telegram_id": "@ali", "national_code": "0499370899",
            "extra_values-TOTAL_FORMS": "1", "extra_values-INITIAL_FORMS": "0",
            "extra_values-0-field": FieldDefinition.objects.get(name="ایمیل").pk,
            "extra_values-0-value": "ali@x.ir",
        }
        resp = self.client.post(url, data)
        self.assertEqual(resp.status_code, 302, getattr(resp, "context", None) and resp.context.get("errors"))
        c = Contact.objects.get()
        self.assertEqual((c.phone, c.telegram_id, c.created_by), ("09121234567", "ali", self.user))
        self.assertTrue(ChangeLog.objects.filter(contact=c, changed_by=self.user, field_name="phone").exists())

        for u in [
            reverse("admin:crm_contact_change", args=[c.pk]),
            reverse("admin:crm_contact_snapshot", args=[c.pk]) + "?at=1405/07/09",
            reverse("admin:crm_changelog_changelist") + f"?contact={c.pk}&field_name=phone",
            reverse("admin:crm_contact_changelist") + "?q=۰۹۱۲۱۲۳۴۵۶۷",
        ]:
            self.assertEqual(self.client.get(u).status_code, 200, u)
        resp = self.client.get(reverse("admin:crm_contact_changelist") + "?q=+989121234567")
        self.assertContains(resp, "رضایی")
