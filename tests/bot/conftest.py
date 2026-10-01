"""Loads bot/nutribot.py with fake credentials and mocked services (no network, no real keys)."""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest

BOT_FILE = Path(__file__).resolve().parents[2] / "bot" / "nutribot.py"
NACHO, MAMA = 111111111, 222222222


class FakeQuery:
    """Supabase query builder stand-in: any chained call returns itself, execute() returns the rows."""
    def __init__(self, rows=None, error=None):
        self._rows, self._error = rows, error

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        if self._error:
            raise self._error
        return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self):
        self.tables = {}

    def set(self, table, rows=None, error=None):
        self.tables[table] = FakeQuery(rows, error)

    def table(self, name):
        return self.tables.get(name, FakeQuery([]))


class FakeGemini:
    """gemini.models.generate_content(model=..., contents=...) driven by a script per model."""
    def __init__(self, script):
        self.script, self.calls = script, []
        self.models = SimpleNamespace(generate_content=self._generate)

    def _generate(self, model, contents):
        self.calls.append((model, contents))
        outcome = self.script.get(model, "ok")
        if isinstance(outcome, list):
            outcome = outcome.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(text=outcome)


@pytest.fixture(scope="session")
def nb(tmp_path_factory):
    users = tmp_path_factory.mktemp("cfg") / "users.json"
    users.write_text(json.dumps({
        str(NACHO): {"nombre": "Alice", "META_CALORIAS": 2300, "META_PROTEINAS": 185,
                     "META_GRASAS": 75, "META_CARBOHIDRATOS": 220},
        str(MAMA): {"nombre": "Bob", "META_CALORIAS": 1680, "META_PROTEINAS": 125,
                    "META_GRASAS": 55, "META_CARBOHIDRATOS": 170},
    }))
    env = {"TELEGRAM_TOKEN": "123456:TEST", "GEMINI_API_KEY": "test-key",
           "SUPABASE_URL": "https://example.supabase.co", "SUPABASE_KEY": "test-key",
           "USERS_FILE": str(users)}
    env_clear = ["DASHBOARD_URL"]
    with mock.patch.dict(os.environ, env), \
         mock.patch("dotenv.load_dotenv", lambda *a, **k: False), \
         mock.patch("supabase.create_client", lambda *a, **k: FakeSupabase()):
        for name in env_clear:
            os.environ.pop(name, None)
        spec = importlib.util.spec_from_file_location("nutribot", BOT_FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


@pytest.fixture
def sb(nb, monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(nb, "supabase", fake)
    return fake


@pytest.fixture
def fake_gemini(nb, monkeypatch):
    def install(script=None):
        fake = FakeGemini(script or {})
        monkeypatch.setattr(nb, "gemini", fake)
        return fake
    return install


@pytest.fixture(autouse=True)
def reset_model_cooldowns(nb):
    nb.modelos_en_espera.clear()
    yield
    nb.modelos_en_espera.clear()


@pytest.fixture
def clock(nb, monkeypatch):
    """Controllable replacement for the bot's clock."""
    state = SimpleNamespace(now=1000.0)
    monkeypatch.setattr(nb, "_ahora", lambda: state.now)
    state.advance = lambda seconds: setattr(state, "now", state.now + seconds)
    return state
