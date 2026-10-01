"""Reconstruct what a contact looked like at any point in time from ChangeLog."""

import jdatetime
from django.utils import timezone

from .models import ChangeLog, Contact
from .normalize import to_latin_digits


def to_jalali(dt, with_time=True):
    if dt is None:
        return ""
    dt = timezone.localtime(dt)
    fmt = "%Y/%m/%d %H:%M:%S" if with_time else "%Y/%m/%d"
    return jdatetime.datetime.fromgregorian(datetime=dt).strftime(fmt)


def parse_jalali(text):
    """Parse '1405/07/09' or '1405/07/09 14:30[:15]' (Persian digits allowed) to an aware datetime."""
    text = to_latin_digits(text).strip().replace("-", "/")
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            jdt = jdatetime.datetime.strptime(text, fmt)
        except ValueError:
            continue
        if fmt == "%Y/%m/%d":
            jdt = jdt.replace(hour=23, minute=59, second=59)  # whole day included
        return timezone.make_aware(jdt.togregorian())
    raise ValueError("تاریخ نامعتبر است. نمونه: 1405/07/09 14:30")


def snapshot(contact_id, at):
    """Return {'exists', 'deleted', 'fields': [(label, value)], 'extras': [(label, value)]}."""
    logs = ChangeLog.objects.filter(contact_id=contact_id, changed_at__lte=at).order_by("changed_at", "id")
    exists = deleted = False
    values, extras = {}, {}
    for log in logs:
        if log.field_name == ChangeLog.CONTACT_KEY:
            exists = log.action == ChangeLog.CREATE
            deleted = log.action == ChangeLog.DELETE
        elif log.field_name.startswith("extra:"):
            if log.action == ChangeLog.DELETE:
                extras.pop(log.field_name, None)
            else:
                extras[log.field_name] = (log.field_label, log.new_value)
        else:
            values[log.field_name] = log.new_value
    return {
        "exists": exists,
        "deleted": deleted,
        "fields": [(Contact.field_label(f), values.get(f, "")) for f in Contact.TRACKED_FIELDS],
        "extras": sorted(extras.values()),
    }
