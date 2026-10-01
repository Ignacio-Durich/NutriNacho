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


# --- remembering exhausted models --------------------------------------------------------
def quota_with(extra):
    return errors.ClientError(429, {"error": {"code": 429, "message": "quota exceeded",
                                              "status": "RESOURCE_EXHAUSTED", "details": [extra]}})


def retry_in(seconds):
    return quota_with({"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": f"{seconds}s"})


def daily_quota():
    return quota_with({"@type": "type.googleapis.com/google.rpc.QuotaFailure",
                       "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]})


def test_wait_uses_retry_delay_from_the_error(nb):
    assert nb.espera_para_error(retry_in(31)) == 31


def test_wait_is_clamped(nb):
    assert nb.espera_para_error(retry_in(1)) == 5
    assert nb.espera_para_error(retry_in(99999)) == nb.ESPERA_CUOTA_DIARIA


def test_wait_for_daily_quota_is_long(nb):
    assert nb.espera_para_error(daily_quota()) == nb.ESPERA_CUOTA_DIARIA


def test_wait_defaults_when_the_error_gives_no_hint(nb):
    assert nb.espera_para_error(quota()) == nb.ESPERA_LIMITE
    assert nb.espera_para_error(high_demand()) == nb.ESPERA_LIMITE


def test_exhausted_model_is_skipped_on_the_next_call(nb, fake_gemini, clock):
    g = fake_gemini({MODELS[0]: [quota(), "no deberia usarse"], MODELS[1]: "ok"})
    nb.llamar_gemini("primero")
    nb.llamar_gemini("segundo")
    assert [m for m, _ in g.calls] == [MODELS[0], MODELS[1], MODELS[1]]


def test_model_is_tried_again_after_the_wait(nb, fake_gemini, clock):
    g = fake_gemini({MODELS[0]: [quota(), "vuelvo"], MODELS[1]: "ok"})
    nb.llamar_gemini("a")
    clock.advance(nb.ESPERA_LIMITE + 1)
    assert nb.llamar_gemini("b") == "vuelvo"
    assert MODELS[0] not in nb.modelos_en_espera


def test_retry_delay_is_respected(nb, fake_gemini, clock):
    g = fake_gemini({MODELS[0]: [retry_in(30), "vuelvo"], MODELS[1]: "ok"})
    nb.llamar_gemini("a")
    clock.advance(20)
    assert nb.llamar_gemini("b") == "ok"
    clock.advance(11)
    assert nb.llamar_gemini("c") == "vuelvo"


def test_daily_quota_keeps_the_model_out_for_a_long_time(nb, fake_gemini, clock):
    g = fake_gemini({MODELS[0]: [daily_quota(), "vuelvo"], MODELS[1]: "ok"})
    nb.llamar_gemini("a")
    clock.advance(600)
    assert nb.llamar_gemini("b") == "ok"
    clock.advance(3000)
    assert nb.llamar_gemini("c") == "vuelvo"


def test_if_every_model_is_waiting_the_whole_chain_is_tried_anyway(nb, fake_gemini, clock):
    g = fake_gemini({m: [quota(), "ok"] for m in MODELS})
    with pytest.raises(Exception, match="Todos los modelos fallaron"):
        nb.llamar_gemini("a")
    assert len(nb.modelos_en_espera) == len(MODELS)
    g.calls.clear()
    assert nb.llamar_gemini("b") == "ok"
    assert [m for m, _ in g.calls] == [MODELS[0]]


def test_connection_errors_do_not_put_a_model_on_hold(nb, fake_gemini, clock):
    fake_gemini({MODELS[0]: [ConnectionError("reset"), ConnectionError("reset")], MODELS[1]: "ok"})
    nb.llamar_gemini("a")
    assert nb.modelos_en_espera == {}
