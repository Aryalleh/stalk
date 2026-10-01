from contextvars import ContextVar

_current_user = ContextVar("crm_current_user", default=None)


def get_current_user():
    return _current_user.get()


class CurrentUserMiddleware:
    """Expose request.user to model signals so change logs record who edited."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        token = _current_user.set(user if user is not None and user.is_authenticated else None)
        try:
            return self.get_response(request)
        finally:
            _current_user.reset(token)
