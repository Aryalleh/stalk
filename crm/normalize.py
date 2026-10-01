"""Input normalization and validation helpers (Persian digits, phones, IDs)."""

import re

from django.core.exceptions import ValidationError

_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def to_latin_digits(value):
    return (value or "").translate(_DIGIT_MAP)


def normalize_phone(value):
    """Return the phone in local form (09121234567 / 02112345678); '' stays ''."""
    value = re.sub(r"[\s\-()./]", "", to_latin_digits(value))
    if not value:
        return ""
    if value.startswith("+98"):
        value = "0" + value[3:]
    elif value.startswith("0098"):
        value = "0" + value[4:]
    elif value.startswith("98") and len(value) == 12:
        value = "0" + value[2:]
    elif value.startswith("9") and len(value) == 10:
        value = "0" + value
    return value


def validate_phone(value):
    if value and not re.fullmatch(r"\+?\d{5,15}", value):
        raise ValidationError("شماره تماس نامعتبر است.")


def normalize_digits(value):
    return re.sub(r"[\s\-]", "", to_latin_digits(value))


def validate_national_code(value):
    """Iranian national code (کد ملی) checksum."""
    if not value:
        return
    if not re.fullmatch(r"\d{10}", value) or len(set(value)) == 1:
        raise ValidationError("کد ملی باید ۱۰ رقم معتبر باشد.")
    check = int(value[9])
    s = sum(int(value[i]) * (10 - i) for i in range(9)) % 11
    if not ((s < 2 and check == s) or (s >= 2 and check == 11 - s)):
        raise ValidationError("کد ملی نامعتبر است (رقم کنترل اشتباه است).")


def validate_postal_code(value):
    if value and not re.fullmatch(r"\d{10}", value):
        raise ValidationError("کد پستی باید ۱۰ رقم باشد.")


_SOCIAL_URL = re.compile(
    r"^(?:https?://)?(?:www\.)?"
    r"(?:t\.me|telegram\.me|instagram\.com|twitter\.com|x\.com|ble\.ir)/(?:@)?([^/?#]+)",
    re.IGNORECASE,
)


def normalize_handle(value):
    """Accept '@user', 'user' or a profile URL and return just 'user'."""
    value = to_latin_digits(value).strip()
    match = _SOCIAL_URL.match(value)
    if match:
        value = match.group(1)
    return value.lstrip("@").strip()
