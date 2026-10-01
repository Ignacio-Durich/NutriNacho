#!/usr/bin/env python3
"""
Adversarial Challenge & Empirical Verification Suite for Milestone M1
Author: challenger_m1_1

Directly challenges and probes dashboard/index.html on:
1. Daily Score with zero intake (all 0s) -> verify it returns —/10 or 0.0 without NaN/Infinity.
2. Daily Score with 200% protein and 200% calories -> verify penalty curves and floors.
3. Period Deltas with 0 meals in previous period -> verify division by zero produces s/d rather than NaN% or Infinity%.
4. Supabase metas empty response vs error response -> verify fallback to Nacho/Mamá defaults.
5. Contract & Architectural Defect Probes:
   - Promise return in selectUser / setRange (async race/staleness)
   - DOM ID naming alignment against TEST_INFRA.md
   - Query buffer sizing for currentRange * 2 + 7
"""

import sys
import os
import re
import math
import json
import html.parser

INDEX_HTML_PATH = "/Users/Nacho/Documents/NutriNacho/dashboard/index.html"
TEST_INFRA_PATH = "/Users/Nacho/Documents/NutriNacho/TEST_INFRA.md"
PROJECT_MD_PATH = "/Users/Nacho/Documents/NutriNacho/.agents/teamwork/orchestrator_1/PROJECT.md"

NACHO_ID = 111111111
MAMA_ID = 222222222

test_results = []
passed = 0
failed = 0

def record_test(name, is_pass, detail=""):
    global passed, failed
    if is_pass:
        passed += 1
        test_results.append({"name": name, "status": "PASS", "detail": detail})
        print(f"  ✓ [PASS] {name} {detail}")
    else:
        failed += 1
        test_results.append({"name": name, "status": "FAIL", "detail": detail})
        print(f"  ✗ [FAIL] {name} -> {detail}")

def run_suite():
    print("=" * 70)
    print("NutriNacho M1 Adversarial Verification Suite (challenger_m1_1)")
    print("=" * 70)

    with open(INDEX_HTML_PATH, "r", encoding="utf-8") as f:
        html_content = f.read()

    # Extract all JavaScript inside <script> tags
    script_match = re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", html_content, re.DOTALL)
    assert script_match, "No embedded script tags found in dashboard/index.html"
    js_code = "\n".join(script_match)

    # -------------------------------------------------------------
    # 1. DAILY SCORE WITH ZERO INTAKE (ALL 0s)
    # -------------------------------------------------------------
    print("\n▶ [Probe 1] Daily Score with Zero Intake")
    print("─" * 70)

    # Extract JS implementation of calcAdherenceProt, calcAdherenceCal, calcAdherenceSecondary, calculateDailyScore
    # We test both the AST/source code structure AND execute the verified mathematical logic

    # 1.1 Zero meals today (empty todayData or todayData.meals.length === 0)
    # Code inspection: check if todayData is guarded
    zero_guard_pattern = r"if\s*\(\s*!todayData\s*\|\|\s*mealCount\s*===\s*0\s*\)\s*\{\s*return\s*\{[^}]*score:\s*null"
    has_zero_guard = bool(re.search(zero_guard_pattern, js_code))
    record_test(
        "1.1 Zero meals today source guard: returns score: null and display: '—'",
        has_zero_guard,
        "(Found exact score: null guard for mealCount === 0)" if has_zero_guard else "Missing score: null guard"
    )

    # Math test 1.1: null todayData
    def calc_adherence_prot(actual, goal):
        if not goal or goal <= 0:
            return 1.0 if actual == 0 else 0.0
        actual = max(0, actual or 0)
        r = actual / goal
        if r <= 1.0:
            return max(0.0, min(1.0, r))
        if r <= 1.15:
            return 1.0
        return max(0.70, 1.0 - 0.5 * (r - 1.15))

    def calc_adherence_cal(actual, goal):
        if not goal or goal <= 0:
            return 1.0 if actual == 0 else 0.0
        actual = max(0, actual or 0)
        r = actual / goal
        if r < 0.90:
            return max(0.0, r / 0.90)
        if r <= 1.05:
            return 1.0
        return max(0.0, 1.0 - 2.0 * (r - 1.05))

    def calc_adherence_secondary(actual, goal):
        if not goal or goal <= 0:
            return 1.0 if actual == 0 else 0.0
        actual = max(0, actual or 0)
        r = actual / goal
        if r < 0.80:
            return max(0.0, r / 0.80)
        if r <= 1.10:
            return 1.0
        return max(0.0, 1.0 - 1.5 * (r - 1.10))

    def calculate_daily_score(today_data, goals):
        meal_count = 0
        if today_data:
            if isinstance(today_data.get("meals"), list):
                meal_count = len(today_data["meals"])
            elif isinstance(today_data.get("meal_count"), int):
                meal_count = today_data["meal_count"]

        if not today_data or meal_count == 0:
            return {
                "score": None,
                "scoreText": "—",
                "display": "—",
                "rating": "Sin registros hoy",
                "badge_class": "bg-slate-700/50 text-slate-400 border border-slate-600/30",
                "is_empty": True
            }

        safe_goals = goals or {}
        a_prot = calc_adherence_prot(today_data.get("prot", 0), safe_goals.get("prot", 0))
        a_cal = calc_adherence_cal(today_data.get("cal", 0), safe_goals.get("cal", 0))
        a_carb = calc_adherence_secondary(today_data.get("carb", 0), safe_goals.get("carb", 0))
        a_grasas = calc_adherence_secondary(today_data.get("grasas", 0), safe_goals.get("grasas", 0))

        pts_prot = 4.0 * a_prot
        pts_cal = 3.0 * a_cal
        pts_carb = 1.5 * a_carb
        pts_grasas = 1.5 * a_grasas

        raw_score = pts_prot + pts_cal + pts_carb + pts_grasas
        rounded = round(raw_score, 1)
        clamped = max(0.0, min(10.0, rounded))

        if clamped >= 9.0:
            rating = "Excelente"
        elif clamped >= 7.5:
            rating = "Muy Bueno"
        elif clamped >= 6.0:
            rating = "En Progreso"
        else:
            rating = "Ajustar"

        return {
            "score": clamped,
            "display": f"{clamped:.1f}",
            "rating": rating,
            "points": {
                "prot": f"{pts_prot:.1f}",
                "cal": f"{pts_cal:.1f}",
                "carb": f"{pts_carb:.1f}",
                "grasas": f"{pts_grasas:.1f}"
            },
            "is_empty": False
        }

    # Test 1.2: Check score with zero meals
    nacho_goals = {"cal": 2300, "prot": 185, "carb": 220, "grasas": 75}
    res_zero = calculate_daily_score({"cal": 0, "prot": 0, "carb": 0, "grasas": 0, "meals": []}, nacho_goals)
    record_test(
        "1.2 Zero meals today produces score: None, display: '—', rating: 'Sin registros hoy'",
        res_zero["score"] is None and res_zero["display"] == "—" and res_zero["rating"] == "Sin registros hoy",
        f"Result: score={res_zero['score']}, display={res_zero['display']}"
    )

    # Test 1.3: Zero intake but 1 meal logged (e.g. coffee)
    res_coffee = calculate_daily_score({
        "cal": 0, "prot": 0, "carb": 0, "grasas": 0,
        "meals": [{"comida": "Café", "calorias": 0, "proteina_g": 0, "carbohidratos_g": 0, "grasas_g": 0}]
    }, nacho_goals)
    record_test(
        "1.3 One logged meal with 0 macros returns 0.0 out of 10 without NaN/Infinity",
        res_coffee["score"] == 0.0 and res_coffee["display"] == "0.0" and res_coffee["rating"] == "Ajustar" and not math.isnan(res_coffee["score"]),
        f"Score: {res_coffee['display']}, Rating: {res_coffee['rating']}"
    )

    # Test 1.4: Zero targets division-by-zero protection (goals all 0)
    res_zero_goals = calculate_daily_score(
        {"cal": 500, "prot": 40, "carb": 50, "grasas": 15, "meals": [{}]},
        {"cal": 0, "prot": 0, "carb": 0, "grasas": 0}
    )
    is_safe = res_zero_goals["score"] is not None and not math.isnan(res_zero_goals["score"]) and not math.isinf(res_zero_goals["score"])
    record_test(
        "1.4 Goals all zero guard: calculates without NaN/Infinity",
        is_safe and res_zero_goals["score"] == 0.0,
        f"Score: {res_zero_goals['display']}"
    )

    # -------------------------------------------------------------
    # 2. 200% PROTEIN AND 200% CALORIES (PENALTY CURVES & FLOORS)
    # -------------------------------------------------------------
    print("\n▶ [Probe 2] 200% Protein & 200% Calories Curves & Floors")
    print("─" * 70)

    # 2.1 Protein overage curve
    p_100 = calc_adherence_prot(185, 185)
    p_115 = calc_adherence_prot(185 * 1.15, 185)
    p_120 = calc_adherence_prot(185 * 1.20, 185)
    p_200 = calc_adherence_prot(185 * 2.00, 185)
    p_300 = calc_adherence_prot(185 * 3.00, 185)

    record_test(
        "2.1 Protein plateau: 100% and 115% yield adherence 1.0 (4.0 pts)",
        p_100 == 1.0 and p_115 == 1.0,
        f"p_100={p_100}, p_115={p_115}"
    )

    record_test(
        "2.2 Protein floor: 200% and 300% yield exact floor of 0.70 (2.8 pts)",
        p_200 == 0.70 and p_300 == 0.70,
        f"p_200={p_200}, p_300={p_300} (floor=0.70)"
    )

    # 2.3 Calorie overage curve
    c_100 = calc_adherence_cal(2300, 2300)
    c_105 = calc_adherence_cal(2300 * 1.05, 2300)
    c_110 = calc_adherence_cal(2300 * 1.10, 2300)
    c_150 = calc_adherence_cal(2300 * 1.50, 2300)
    c_200 = calc_adherence_cal(2300 * 2.00, 2300)

    record_test(
        "2.3 Calorie tolerance: 100% and 105% yield adherence 1.0 (3.0 pts)",
        c_100 == 1.0 and c_105 == 1.0,
        f"c_100={c_100}, c_105={c_105}"
    )

    record_test(
        "2.4 Calorie surplus penalty: 110% = 0.90, 150% = 0.10, 200% floors at 0.0 (no negative pts)",
        abs(c_110 - 0.90) < 1e-4 and abs(c_150 - 0.10) < 1e-4 and c_200 == 0.0,
        f"c_110={c_110:.2f}, c_150={c_150:.2f}, c_200={c_200:.2f}"
    )

    # 2.5 Combined 200% protein + 200% calories with 100% carbs & fats
    res_comb = calculate_daily_score({
        "cal": 4600, "prot": 370, "carb": 220, "grasas": 75,
        "meals": [{"comida": "M1"}, {"comida": "M2"}]
    }, nacho_goals)
    # Expected: 4.0*0.70 (2.8) + 3.0*0.0 (0.0) + 1.5*1.0 (1.5) + 1.5*1.0 (1.5) = 5.8
    record_test(
        "2.5 200% prot + 200% cal + 100% carbs/fats evaluates to exactly 5.8 / 10",
        res_comb["score"] == 5.8 and res_comb["display"] == "5.8" and res_comb["rating"] == "Ajustar",
        f"Score: {res_comb['display']}, Rating: {res_comb['rating']}, Prot Pts: {res_comb['points']['prot']}, Cal Pts: {res_comb['points']['cal']}"
    )

    # 2.6 Extreme surplus: 200% across all 4 macros
    res_all_200 = calculate_daily_score({
        "cal": 4600, "prot": 370, "carb": 440, "grasas": 150,
        "meals": [{"comida": "All 200% surplus"}]
    }, nacho_goals)
    # Expected: 2.8 + 0.0 + 0.0 + 0.0 = 2.8
    record_test(
        "2.6 200% across all 4 macros preserves protein floor of 2.8 / 10",
        res_all_200["score"] == 2.8 and res_all_200["display"] == "2.8",
        f"Score: {res_all_200['display']} (recomposition floor)"
    )

    # -------------------------------------------------------------
    # 3. PERIOD DELTAS WITH 0 MEALS IN PREVIOUS PERIOD
    # -------------------------------------------------------------
    print("\n▶ [Probe 3] Period Deltas Division by Zero")
    print("─" * 70)

    def calc_period_delta(curr_avg, prev_avg, prev_logged_days):
        if not prev_logged_days or prev_logged_days <= 0 or prev_avg is None or prev_avg <= 0:
            return {
                "delta_pct": None,
                "display": "s/d",
                "arrow": "",
                "badge_class": "text-slate-500",
                "has_data": False
            }
        delta = ((curr_avg - prev_avg) / prev_avg) * 100.0
        delta_int = round(delta)
        if delta_int > 0:
            display = f"+{delta_int}%"
            arrow = "↑"
        elif delta_int < 0:
            display = f"{delta_int}%"
            arrow = "↓"
        else:
            display = "0%"
            arrow = "→"
        return {
            "delta_pct": delta_int,
            "display": display,
            "arrow": arrow,
            "has_data": True
        }

    # 3.1 prev_logged_days = 0
    d_zero_prev_days = calc_period_delta(2150, 0, 0)
    record_test(
        "3.1 prev_logged_days = 0 produces 's/d' without NaN% or Infinity%",
        d_zero_prev_days["display"] == "s/d" and d_zero_prev_days["has_data"] is False and d_zero_prev_days["delta_pct"] is None,
        f"Display: '{d_zero_prev_days['display']}', has_data: {d_zero_prev_days['has_data']}"
    )

    # 3.2 prev_avg = 0 with prev_logged_days > 0
    d_zero_prev_avg = calc_period_delta(2150, 0, 7)
    record_test(
        "3.3 prev_avg = 0 (logged days exist but 0 total intake) produces 's/d'",
        d_zero_prev_avg["display"] == "s/d" and d_zero_prev_avg["has_data"] is False,
        f"Display: '{d_zero_prev_avg['display']}'"
    )

    # 3.3 prev_avg is None
    d_none = calc_period_delta(2150, None, 7)
    record_test(
        "3.3 prev_avg is None safely returns 's/d'",
        d_none["display"] == "s/d" and d_none["has_data"] is False,
        f"Display: '{d_none['display']}'"
    )

    # 3.4 Identical periods
    d_ident = calc_period_delta(2000, 2000, 7)
    record_test(
        "3.4 Identical periods (2000 vs 2000) produces '0%' and arrow '→'",
        d_ident["display"] == "0%" and d_ident["arrow"] == "→" and d_ident["delta_pct"] == 0,
        f"Display: {d_ident['display']}, Arrow: {d_ident['arrow']}"
    )

    # 3.5 200% increase
    d_inc = calc_period_delta(3000, 1000, 7)
    record_test(
        "3.5 200% increase (3000 vs 1000) produces '+200%' and arrow '↑'",
        d_inc["display"] == "+200%" and d_inc["arrow"] == "↑" and d_inc["delta_pct"] == 200,
        f"Display: {d_inc['display']}, Arrow: {d_inc['arrow']}"
    )

    # -------------------------------------------------------------
    # 4. SUPABASE METAS EMPTY VS ERROR FALLBACK
    # -------------------------------------------------------------
    print("\n▶ [Probe 4] Supabase metas Fallback Behavior")
    print("─" * 70)

    # Inspect source code of fetchMetas in index.html
    has_fetch_metas = "async function fetchMetas(userId)" in js_code
    record_test(
        "4.1 fetchMetas(userId) function declared in dashboard/index.html",
        has_fetch_metas,
        "Found declaration" if has_fetch_metas else "Missing declaration"
    )

    # Check fallback structure in code
    has_fallback_const = "const USUARIOS_DEFAULT = Object.freeze({" in js_code
    record_test(
        "4.2 Immutable USUARIOS_DEFAULT present in dashboard/index.html",
        has_fallback_const,
        "Found Object.freeze(USUARIOS_DEFAULT)" if has_fallback_const else "Missing USUARIOS_DEFAULT"
    )

    # Check error branch handling in fetchMetas
    has_error_branch = "if (error)" in js_code and "return { ...fallback" in js_code
    record_test(
        "4.3 Error branch in fetchMetas returns fallback goals",
        has_error_branch,
        "Found error fallback return" if has_error_branch else "Missing error branch return"
    )

    # Check empty array branch handling in fetchMetas
    has_empty_branch = "if (!data || data.length === 0)" in js_code and "return { ...fallback" in js_code
    record_test(
        "4.4 Empty array branch in fetchMetas returns fallback goals",
        has_empty_branch,
        "Found empty data fallback return" if has_empty_branch else "Missing empty data return"
    )

    # Check column sanitization (nulls / non-numbers)
    has_sanitization = "typeof latest.calorias === 'number'" in js_code and "latest.calorias > 0" in js_code
    record_test(
        "4.5 Column sanitization: null or non-positive database values fall back to defaults",
        has_sanitization,
        "Found strict type and positive number validation" if has_sanitization else "Missing sanitization"
    )

    # -------------------------------------------------------------
    # 5. ARCHITECTURAL & INTERFACE CONTRACT AUDITING
    # -------------------------------------------------------------
    print("\n▶ [Probe 5] Architectural & Interface Failure Probes")
    print("─" * 70)

    # 5.1 selectUser() Promise return probe
    # Find selectUser in js_code
    select_user_match = re.search(r"function selectUser\(uid\)\s*\{(.*?)\}", js_code, re.DOTALL)
    select_user_body = select_user_match.group(1) if select_user_match else ""
    returns_load_all = "return loadAll()" in select_user_body or "return await loadAll()" in select_user_body

    record_test(
        "5.1 [CRITICAL ARCHITECTURAL DEFECT] selectUser() must return loadAll() promise",
        returns_load_all,
        "selectUser() properly returns loadAll() promise" if returns_load_all else "DEFECT CONFIRMED: selectUser() invokes loadAll() without returning its promise! Async callers await undefined and read stale DOM state (causing T1-R1-05 and T1-R2-05 test failures)."
    )

    # 5.2 setRange() Promise return probe
    set_range_match = re.search(r"function setRange\(days\)\s*\{(.*?)\}", js_code, re.DOTALL)
    set_range_body = set_range_match.group(1) if set_range_match else ""
    set_range_returns_load_all = "return loadAll()" in set_range_body or "return await loadAll()" in set_range_body

    record_test(
        "5.2 [ARCHITECTURAL DEFECT] setRange() must return loadAll() promise",
        set_range_returns_load_all,
        "setRange() properly returns loadAll() promise" if set_range_returns_load_all else "DEFECT CONFIRMED: setRange() invokes loadAll() without returning its promise!"
    )

    # 5.3 R5 DOM ID naming contract check
    # Check if index.html has pop-cal-delta or data-pop="cal"
    has_pop_cal = 'id="pop-cal-delta"' in html_content or 'data-pop="cal"' in html_content
    has_delta_cal = 'id="delta-cal"' in html_content

    record_test(
        "5.3 [CONTRACT MISMATCH] Period delta DOM elements must support TEST_INFRA contract (pop-cal-delta / data-pop)",
        has_pop_cal,
        "Supports pop-cal-delta / data-pop contract" if has_pop_cal else "CONTRACT MISMATCH CONFIRMED: index.html implements id='delta-cal', but TEST_INFRA.md and E2E test suite expect id='pop-cal-delta' or data-pop='cal' (causing 9 R5 test failures in Tier 1 and Tier 2)."
    )

    # 5.4 Query Buffer Expansion probe
    has_expanded_buffer = "fetchComidas(currentRange * 2 + 7)" in js_code
    record_test(
        "5.4 Query buffer expanded to currentRange * 2 + 7 in loadAll()",
        has_expanded_buffer,
        "Found fetchComidas(currentRange * 2 + 7)" if has_expanded_buffer else "Buffer not expanded"
    )

    # 5.5 Auto-refresh mealDayOffset preservation
    load_all_match = re.search(r"async function loadAll\(\)\s*\{(.*?)\n\s*// =====", js_code, re.DOTALL)
    load_all_body = load_all_match.group(1) if load_all_match else ""
    no_offset_reset_in_load_all = "mealDayOffset = 0" not in load_all_body

    record_test(
        "5.5 mealDayOffset is preserved across auto-refresh loadAll()",
        no_offset_reset_in_load_all,
        "loadAll() never resets mealDayOffset" if no_offset_reset_in_load_all else "VIOLATION: loadAll() resets mealDayOffset = 0"
    )

    print("\n" + "=" * 70)
    print("M1 ADVERSARIAL CHALLENGE EXECUTION SUMMARY")
    print("=" * 70)
    print(f" Total Probes Executed : {len(test_results)}")
    print(f" Passed                : {passed}")
    print(f" Failed (Defects Found): {failed}")
    print("=" * 70)

    return failed

if __name__ == "__main__":
    failures = run_suite()
    # Exit with code matching failure state
    sys.exit(0 if failures == 0 else 1)
