from django.contrib import admin
from django.urls import path
from django.views.generic import RedirectView

admin.site.site_header = "CRM"
admin.site.site_title = "CRM"
admin.site.index_title = "مدیریت مخاطبین"

urlpatterns = [
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/", admin.site.urls),
]
