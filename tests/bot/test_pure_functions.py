import pytest

from conftest import NACHO

DATOS = {"comida": "Plato", "calorias": 400, "proteina_g": 30, "carbohidratos_g": 50, "grasas_g": 12}


# --- parsear_json_gemini ---------------------------------------------------------------
def test_parse_plain_json(nb):
    assert nb.parsear_json_gemini('{"calorias": 100}') == {"calorias": 100}


def test_parse_json_inside_markdown_fence(nb):
    assert nb.parsear_json_gemini('```json\n{"calorias": 100}\n```') == {"calorias": 100}


def test_parse_json_with_text_around_it(nb):
    assert nb.parsear_json_gemini('Claro! Aquí va: {"calorias": 100} Espero que sirva') == {"calorias": 100}


def test_parse_invalid_json_raises(nb):
    with pytest.raises(ValueError):
        nb.parsear_json_gemini("no hay json acá")


# --- limpiar_decimales -----------------------------------------------------------------
def test_limpiar_decimales_rounds_floats_and_numeric_strings(nb):
    out = nb.limpiar_decimales({"calorias": 399.6, "proteina_g": "75.4", "carbohidratos_g": 0, "grasas_g": 8.2})
    assert out == {"calorias": 400, "proteina_g": 75, "carbohidratos_g": 0, "grasas_g": 8}


def test_limpiar_decimales_keeps_other_keys_and_missing_macros(nb):
    out = nb.limpiar_decimales({"comida": "Pollo", "calorias": 100.2})
    assert out == {"comida": "Pollo", "calorias": 100}


# --- es_error_limite -------------------------------------------------------------------
@pytest.mark.parametrize("msg", [
    "429 RESOURCE_EXHAUSTED. You exceeded your current quota",
    "Too Many Requests",
    "model is overloaded",
    "503 UNAVAILABLE. This model is currently experiencing high demand",
])
def test_es_error_limite_true(nb, msg):
    assert nb.es_error_limite(Exception(msg))


@pytest.mark.parametrize("msg", ["400 INVALID_ARGUMENT. API key not valid", "JSON malformado", "404 model not found"])
def test_es_error_limite_false(nb, msg):
    assert not nb.es_error_limite(Exception(msg))


# --- corregir_sin_ia -------------------------------------------------------------------
@pytest.mark.parametrize("texto, esperado", [
    ("era la mitad", {"calorias": 200, "proteina_g": 15, "carbohidratos_g": 25, "grasas_g": 6}),
    ("fue el doble", {"calorias": 800, "proteina_g": 60, "carbohidratos_g": 100, "grasas_g": 24}),
    ("solo un tercio", {"calorias": 133, "proteina_g": 10, "carbohidratos_g": 16, "grasas_g": 4}),
    ("multiplicar por 3", {"calorias": 1200, "proteina_g": 90, "carbohidratos_g": 150, "grasas_g": 36}),
])
def test_corregir_scaling(nb, texto, esperado):
    out = nb.corregir_sin_ia(texto, DATOS)
    assert {k: out[k] for k in esperado} == esperado


def test_corregir_sets_calories(nb):
    assert nb.corregir_sin_ia("en realidad eran 550 kcal", DATOS)["calorias"] == 550


def test_corregir_sets_protein(nb):
    assert nb.corregir_sin_ia("tiene 45g de proteína", DATOS)["proteina_g"] == 45


def test_corregir_unknown_text_returns_none(nb):
    assert nb.corregir_sin_ia("no entiendo qué hay que cambiar", DATOS) is None


def test_corregir_does_not_mutate_original(nb):
    original = dict(DATOS)
    nb.corregir_sin_ia("la mitad", original)
    assert original == DATOS


# --- buscar_en_base_local --------------------------------------------------------------
HUEVO = {"nombre": "Huevo", "porcion": "1 unidad", "calorias": 70, "proteina_g": 6, "carbohidratos_g": 1, "grasas_g": 5}


def test_base_local_exact_match(nb, sb):
    sb.set("alimentos_frecuentes", [HUEVO])
    assert nb.buscar_en_base_local("huevo") == {
        "comida": "Huevo", "calorias": 70, "proteina_g": 6, "carbohidratos_g": 1, "grasas_g": 5}


def test_base_local_leading_number_is_a_multiplier(nb, sb):
    sb.set("alimentos_frecuentes", [HUEVO])
    out = nb.buscar_en_base_local("3 huevos")
    assert out["comida"] == "3x Huevo" and out["calorias"] == 210 and out["proteina_g"] == 18


def test_base_local_no_match_returns_none(nb, sb):
    sb.set("alimentos_frecuentes", [HUEVO])
    assert nb.buscar_en_base_local("pizza") is None


def test_base_local_empty_table_returns_none(nb, sb):
    sb.set("alimentos_frecuentes", [])
    assert nb.buscar_en_base_local("huevo") is None


def test_base_local_database_error_returns_none(nb, sb):
    sb.set("alimentos_frecuentes", error=RuntimeError("db down"))
    assert nb.buscar_en_base_local("huevo") is None


# --- obtener_meta_actual ---------------------------------------------------------------
def test_meta_actual_prefers_latest_database_row(nb, sb):
    fila = {"id": 9, "calorias": 2400, "proteina_g": 190, "carbohidratos_g": 230, "grasas_g": 80}
    sb.set("metas", [fila])
    assert nb.obtener_meta_actual(NACHO) == fila


@pytest.mark.parametrize("estado", [dict(rows=[]), dict(error=RuntimeError("db down"))])
def test_meta_actual_falls_back_to_users_file(nb, sb, estado):
    sb.set("metas", **estado)
    assert nb.obtener_meta_actual(NACHO) == {
        "id": None, "calorias": 2300, "proteina_g": 185, "carbohidratos_g": 220, "grasas_g": 75}


def test_meta_actual_unknown_user_returns_none(nb, sb):
    sb.set("metas", [])
    assert nb.obtener_meta_actual(999) is None


# --- extraer_dias_consulta (uses Gemini) -----------------------------------------------
@pytest.mark.parametrize("respuesta, dias", [("30", 30), ("Son 21 días", 21), ("0", 1), ("500", 180), ("sin número", 7)])
def test_extraer_dias(nb, fake_gemini, respuesta, dias):
    fake_gemini({"gemini-3.1-flash-lite": respuesta})
    assert nb.extraer_dias_consulta("cómo vengo este último mes") == dias


def test_extraer_dias_defaults_to_7_when_gemini_fails(nb, fake_gemini):
    fake_gemini({"gemini-3.1-flash-lite": RuntimeError("boom")})
    assert nb.extraer_dias_consulta("hola") == 7


# --- obtener_consumo_historico ---------------------------------------------------------
def test_consumo_historico_averages_per_logged_day(nb, sb):
    sb.set("comidas", [
        {"fecha": "2026-09-28T12:00:00", "calorias": 1000, "proteina_g": 80, "carbohidratos_g": 100, "grasas_g": 30},
        {"fecha": "2026-09-28T18:00:00", "calorias": 1000, "proteina_g": 60, "carbohidratos_g": 100, "grasas_g": 30},
        {"fecha": "2026-09-29T12:00:00", "calorias": 1000, "proteina_g": 40, "carbohidratos_g": 100, "grasas_g": 30},
    ])
    assert nb.obtener_consumo_historico(NACHO, 7) == (1500, 90, 150, 45, 2)


def test_consumo_historico_empty_returns_zeros(nb, sb):
    sb.set("comidas", [])
    assert nb.obtener_consumo_historico(NACHO, 7) == (0, 0, 0, 0, 0)
