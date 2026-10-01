import csv

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db import models
from django.db.models import Q
from django.http import HttpResponse
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html, format_html_join

from .history import parse_jalali, snapshot, to_jalali
from .models import ChangeLog, Contact, ExtraValue, FieldDefinition
from .normalize import normalize_phone, to_latin_digits


class ExtraValueInline(admin.TabularInline):
    model = ExtraValue
    extra = 1
    autocomplete_fields = ["field"]
    formfield_overrides = {models.TextField: {"widget": forms.TextInput(attrs={"size": 60})}}


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    inlines = [ExtraValueInline]
    list_display = ["__str__", "phone", "national_code", "telegram_id", "instagram_id", "updated_jalali"]
    search_fields = [
        "first_name", "last_name", "father_name", "national_code", "postal_code",
        "phone", "phone2", "father_phone",
        "telegram_id", "instagram_id", "twitter_id", "bale_id",
        "address", "notes", "extra_values__value",
    ]
    readonly_fields = ["created_jalali", "updated_jalali", "created_by", "history_table"]
    actions = ["export_csv"]
    fieldsets = [
        ("مشخصات", {"fields": [("first_name", "last_name"), "father_name", "national_code"]}),
        ("تماس", {"fields": ["phone", "phone2", "father_phone"]}),
        ("شبکه‌های اجتماعی", {"fields": [("telegram_id", "instagram_id"), ("twitter_id", "bale_id")]}),
        ("آدرس", {"fields": ["postal_code", "address"]}),
        ("سایر", {"fields": ["notes", ("created_jalali", "updated_jalali", "created_by")]}),
        ("سابقه تغییرات", {"fields": ["history_table"], "classes": ["collapse"]}),
    ]

    def get_search_results(self, request, queryset, search_term):
        # Persian digits / +98 phone formats should still match.
        term = to_latin_digits(search_term).strip()
        qs, distinct = super().get_search_results(request, queryset, term)
        phone = normalize_phone(term)
        if phone and phone != term:
            qs |= queryset.filter(
                Q(phone=phone) | Q(phone2=phone) | Q(father_phone=phone)
            )
        return qs, True

    @admin.display(description="تاریخ ایجاد")
    def created_jalali(self, obj):
        return to_jalali(obj.created_at)

    @admin.display(description="آخرین ویرایش", ordering="updated_at")
    def updated_jalali(self, obj):
        return to_jalali(obj.updated_at)

    @admin.display(description="تغییرات")
    def history_table(self, obj):
        if not obj.pk:
            return "-"
        logs = obj.change_logs.select_related("changed_by").exclude(field_name=ChangeLog.CONTACT_KEY)[:300]
        log_url = reverse("admin:crm_changelog_changelist")
        snap_url = reverse("admin:crm_contact_snapshot", args=[obj.pk])
        rows = format_html_join(
            "",
            "<tr><td>{}</td><td><a href='{}?contact={}&field_name={}'>{}</a></td><td>{}</td>"
            "<td>{}</td><td>{}</td><td>{}</td><td><a href='{}?at={}'>مشاهده</a></td></tr>",
            (
                (
                    to_jalali(log.changed_at), log_url, obj.pk, log.field_name, log.field_label,
                    log.get_action_display(), log.old_value or "—", log.new_value or "—",
                    log.changed_by or "—", snap_url, to_jalali(log.changed_at),
                )
                for log in logs
            ),
        )
        return format_html(
            "<p><a class='button' href='{}'>وضعیت پرونده در یک تاریخ دلخواه</a></p>"
            "<table><thead><tr><th>زمان</th><th>فیلد</th><th>عملیات</th><th>قبلی</th>"
            "<th>جدید</th><th>کاربر</th><th>وضعیت در آن لحظه</th></tr></thead><tbody>{}</tbody></table>",
            snap_url, rows,
        )

    def get_urls(self):
        return [
            path(
                "<int:pk>/snapshot/",
                self.admin_site.admin_view(self.snapshot_view),
                name="crm_contact_snapshot",
            )
        ] + super().get_urls()

    def snapshot_view(self, request, pk):
        if not self.has_view_permission(request):
            raise PermissionDenied
        contact = Contact.objects.filter(pk=pk).first()
        at_text = request.GET.get("at", "").strip()
        at = timezone.now()
        if at_text:
            try:
                at = parse_jalali(at_text)
            except ValueError as e:
                messages.error(request, str(e))
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": f"وضعیت پرونده در {to_jalali(at)}",
            "contact": contact,
            "contact_id": pk,
            "at_text": at_text or to_jalali(at),
            "snap": snapshot(pk, at),
        }
        return TemplateResponse(request, "admin/crm/contact/snapshot.html", context)

    @admin.action(description="خروجی CSV (اکسل) از موارد انتخاب‌شده")
    def export_csv(self, request, queryset):
        queryset = queryset.prefetch_related("extra_values__field")
        extra_names = list(FieldDefinition.objects.values_list("name", flat=True))
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="contacts.csv"'
        response.write("﻿")  # BOM so Excel shows Persian correctly
        writer = csv.writer(response)
        writer.writerow(["id"] + [Contact.field_label(f) for f in Contact.TRACKED_FIELDS] + extra_names)
        for c in queryset:
            extras = {ev.field.name: ev.value for ev in c.extra_values.all()}
            writer.writerow(
                [c.pk] + [getattr(c, f) for f in Contact.TRACKED_FIELDS] + [extras.get(x, "") for x in extra_names]
            )
        return response


@admin.register(FieldDefinition)
class FieldDefinitionAdmin(admin.ModelAdmin):
    search_fields = ["name"]


@admin.register(ChangeLog)
class ChangeLogAdmin(admin.ModelAdmin):
    list_display = ["changed_jalali", "contact_link", "field_label", "action", "old_value", "new_value", "changed_by"]
    list_filter = ["action", "field_label", "changed_by"]
    search_fields = ["contact_repr", "field_label", "old_value", "new_value"]
    list_select_related = ["changed_by"]

    def lookup_allowed(self, lookup, value, request=None):
        # Allows ?contact=<id>&field_name=<key> to show one contact's / one field's history.
        return lookup in ("contact", "field_name") or super().lookup_allowed(lookup, value, request)

    @admin.display(description="زمان", ordering="changed_at")
    def changed_jalali(self, obj):
        return to_jalali(obj.changed_at)

    @admin.display(description="مخاطب")
    def contact_link(self, obj):
        url = reverse("admin:crm_contact_change", args=[obj.contact_id])
        return format_html("<a href='{}'>{}</a>", url, obj.contact_repr)

    # The log is append-only.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
