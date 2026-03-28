from rest_framework.response import Response

def ok(data=None, status=200):
    return Response({"ok": True, "data": data}, status=status)
