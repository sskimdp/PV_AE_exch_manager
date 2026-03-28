from django.contrib import admin
from .models import Attachment

@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("id", "filename", "message", "status", "size", "uploaded_at")
    list_filter = ("status",)
    search_fields = ("filename", "storage_key")
