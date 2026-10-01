from django.db import migrations

DEFAULTS = ["ایمیل", "واتساپ", "ایتا", "روبیکا", "لینکدین", "تاریخ تولد", "شغل", "شماره مادر", "تلفن ثابت"]


def add_defaults(apps, schema_editor):
    FieldDefinition = apps.get_model("crm", "FieldDefinition")
    for name in DEFAULTS:
        FieldDefinition.objects.get_or_create(name=name)


class Migration(migrations.Migration):
    dependencies = [("crm", "0001_initial")]
    operations = [migrations.RunPython(add_defaults, migrations.RunPython.noop)]
