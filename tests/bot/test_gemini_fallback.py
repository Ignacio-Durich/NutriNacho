import pytest
from google.genai import errors

MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]


def quota():
    return errors.ClientError(429, {"error": {"code": 429, "message": "quota exceeded", "status": "RESOURCE_EXHAUSTED"}})


def high_demand():
    return errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})


@pytest.fixture(autouse=True)
def no_sleep(nb, monkeypatch):
    monkeypatch.setattr(nb.time, "sleep", lambda s: None)


def test_chain_order_matches_the_documented_models(nb):
    assert nb.MODELOS_FALLBACK == MODELS


def test_first_model_answers(nb, fake_gemini):
    g = fake_gemini({MODELS[0]: "hola"})
    assert nb.llamar_gemini("prompt") == "hola"
    assert [m for m, _ in g.calls] == [MODELS[0]]


def test_contents_are_passed_through_unchanged(nb, fake_gemini):
    g = fake_gemini()
    contenido = ["describe esto", object()]
    nb.llamar_gemini(contenido)
    assert g.calls[0][1] is contenido


def test_quota_error_moves_to_next_model(nb, fake_gemini):
    g = fake_gemini({MODELS[0]: quota(), MODELS[1]: quota(), MODELS[2]: "ok"})
    assert nb.llamar_gemini("p") == "ok"
    assert [m for m, _ in g.calls] == MODELS[:3]


def test_503_high_demand_moves_to_next_model(nb, fake_gemini):
    g = fake_gemini({MODELS[0]: high_demand(), MODELS[1]: "ok"})
    assert nb.llamar_gemini("p") == "ok"
    assert [m for m, _ in g.calls] == MODELS[:2]


def test_connection_error_is_retried_then_next_model(nb, fake_gemini):
    g = fake_gemini({MODELS[0]: [ConnectionError("reset"), ConnectionError("reset")], MODELS[1]: "ok"})
    assert nb.llamar_gemini("p") == "ok"
    assert [m for m, _ in g.calls] == [MODELS[0], MODELS[0], MODELS[1]]


def test_connection_error_recovers_on_retry(nb, fake_gemini):
    g = fake_gemini({MODELS[0]: [TimeoutError("timeout"), "ok"]})
    assert nb.llamar_gemini("p") == "ok"
    assert [m for m, _ in g.calls] == [MODELS[0], MODELS[0]]


def test_unexpected_error_is_raised_immediately(nb, fake_gemini):
    g = fake_gemini({MODELS[0]: ValueError("bad request")})
    with pytest.raises(ValueError):
        nb.llamar_gemini("p")
    assert len(g.calls) == 1


def test_all_models_failing_raises_with_last_error(nb, fake_gemini):
    fake_gemini({m: quota() for m in MODELS})
    with pytest.raises(Exception, match="Todos los modelos fallaron"):
        nb.llamar_gemini("p")
