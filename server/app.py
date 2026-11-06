"""Compatibility entry point; HTTP implementation lives in server.api.app."""
from .api.app import create_app

__all__ = ["create_app"]
