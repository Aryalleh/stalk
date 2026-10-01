"""Write a ChangeLog row for every field that is created, changed or removed."""

from django.db.models.signals import post_delete, post_save, pre_delete, pre_save
from django.dispatch import receiver

from .middleware import get_current_user
from .models import ChangeLog, Contact, ExtraValue


def _str(value):
    return "" if value is None else str(value)


def _log(contact, field_name, field_label, action, old="", new=""):
    ChangeLog.objects.create(
        contact_id=contact.pk,
        contact_repr=str(contact)[:255],
        field_name=field_name,
        field_label=field_label,
        action=action,
        old_value=_str(old),
        new_value=_str(new),
        changed_by=get_current_user(),
    )


@receiver(pre_save, sender=Contact)
def _contact_pre_save(sender, instance, **kwargs):
    instance._crm_old = None
    if instance.pk:
        instance._crm_old = (
            Contact.objects.filter(pk=instance.pk).values(*Contact.TRACKED_FIELDS).first()
        )
    if instance._state.adding and instance.created_by_id is None:
        instance.created_by = get_current_user()


@receiver(post_save, sender=Contact)
def _contact_post_save(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    old = getattr(instance, "_crm_old", None)
    if created or old is None:
        _log(instance, ChangeLog.CONTACT_KEY, "مخاطب", ChangeLog.CREATE)
        for name in Contact.TRACKED_FIELDS:
            value = getattr(instance, name)
            if value:
                _log(instance, name, Contact.field_label(name), ChangeLog.CREATE, "", value)
        return
    for name in Contact.TRACKED_FIELDS:
        before, after = _str(old[name]), _str(getattr(instance, name))
        if before != after:
            _log(instance, name, Contact.field_label(name), ChangeLog.UPDATE, before, after)


@receiver(pre_delete, sender=Contact)
def _contact_pre_delete(sender, instance, **kwargs):
    _log(instance, ChangeLog.CONTACT_KEY, "مخاطب", ChangeLog.DELETE)


@receiver(pre_save, sender=ExtraValue)
def _extra_pre_save(sender, instance, **kwargs):
    instance._crm_old = None
    if instance.pk:
        instance._crm_old = (
            ExtraValue.objects.select_related("field").filter(pk=instance.pk).first()
        )


@receiver(post_save, sender=ExtraValue)
def _extra_post_save(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    old = getattr(instance, "_crm_old", None)
    contact, label = instance.contact, instance.field.name
    if created or old is None:
        _log(contact, instance.log_key, label, ChangeLog.CREATE, "", instance.value)
    elif old.field_id != instance.field_id:
        # Moving a value to another field type = removed from one, added to another.
        _log(contact, old.log_key, old.field.name, ChangeLog.DELETE, old.value, "")
        _log(contact, instance.log_key, label, ChangeLog.CREATE, "", instance.value)
    elif old.value != instance.value:
        _log(contact, instance.log_key, label, ChangeLog.UPDATE, old.value, instance.value)


@receiver(post_delete, sender=ExtraValue)
def _extra_post_delete(sender, instance, **kwargs):
    _log(instance.contact, instance.log_key, instance.field.name, ChangeLog.DELETE, instance.value, "")
