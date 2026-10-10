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


def test_main_starts_polling_without_messaging_anyone(nb, bot):
    # Restarting the bot (deploys, VM reboots) must not send anything to the users.
    bot.infinity_polling = MagicMock()
    nb.main()
    bot.infinity_polling.assert_called_once()
    bot.send_message.assert_not_called()
    bot.reply_to.assert_not_called()


def test_metas_wizard_asks_each_macro_retries_non_numbers_and_saves(nb, bot, sb):
    inserted = []
    sb.set("metas", [])
    sb.tables["metas"].insert = lambda row: inserted.append(row) or sb.tables["metas"]
    nb.iniciar_carga_metas(message(NACHO, "/metas"))
    for texto in ["2400", "mucho", "190", "230", "80"]:
        paso, i = bot.register_next_step_handler.call_args.args[1:]
        paso(message(NACHO, texto), i)
    assert inserted == [{"usuario_id": NACHO, "calorias": 2400, "proteina_g": 190,
                         "carbohidratos_g": 230, "grasas_g": 80}]
    assert "Solo números" in bot.reply_to.call_args_list[2].args[1]
    assert "guardadas" in bot.reply_to.call_args.args[1]
