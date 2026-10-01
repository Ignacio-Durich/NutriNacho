from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from conftest import NACHO


def message(user_id, text="/x"):
    return SimpleNamespace(from_user=SimpleNamespace(id=user_id), text=text, caption=None, chat=SimpleNamespace(id=user_id))


@pytest.fixture
def bot(nb, monkeypatch):
    fake = MagicMock()
    monkeypatch.setattr(nb, "bot", fake)
    return fake


def test_dashboard_ignores_unknown_users(nb, bot):
    nb.mandar_dashboard(message(999))
    bot.reply_to.assert_not_called()


def test_dashboard_without_url_says_not_configured(nb, bot, monkeypatch):
    monkeypatch.setattr(nb, "DASHBOARD_URL", None)
    nb.mandar_dashboard(message(NACHO))
    assert "no está configurado" in bot.reply_to.call_args.args[1]
    assert "reply_markup" not in bot.reply_to.call_args.kwargs


def test_dashboard_with_url_sends_a_button(nb, bot, monkeypatch):
    monkeypatch.setattr(nb, "DASHBOARD_URL", "https://dash.example.com")
    nb.mandar_dashboard(message(NACHO))
    markup = bot.reply_to.call_args.kwargs["reply_markup"]
    assert markup.keyboard[0][0].url == "https://dash.example.com"


def test_photo_from_unknown_user_is_denied(nb, bot):
    nb.procesar_foto(message(999))
    assert "Acceso denegado" in bot.reply_to.call_args.args[1]


def test_importing_the_module_does_not_start_polling(nb):
    # The module was imported by the fixtures; main() is only called when run as a script.
    assert callable(nb.main)
