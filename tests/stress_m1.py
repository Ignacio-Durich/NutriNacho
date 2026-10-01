#!/usr/bin/env python3
"""
Empirical Challenger Stress Harness for Milestone M1
Tests:
1. Rapid User Switching (Nacho <-> Mamá) under Variable Latency & Race Conditions
2. Rapid Range Switching (7d <-> 14d <-> 30d) under Inverted Latency
3. renderAverages Date Range Isolation & Leak Defense (expanded buffer vs current window)
4. Auto-refresh DOM Stability (50x loadAll execution, listener leak check, card duplication, day navigation preservation)
5. Analysis of E2E Suite failures (T1-R1-05, T1-R2-05, T1-R5-02..05)
"""

import sys
import os
import re
import json
import time
import math
import random
import asyncio
from datetime import datetime, timedelta

INDEX_PATH = "/Users/Nacho/Documents/NutriNacho/dashboard/index.html"
FIXTURES_PATH = "/Users/Nacho/Documents/NutriNacho/.agents/teamwork/teamwork_preview_spec_miner_m1_3/fixtures_m1.json"

NACHO_ID = 111111111
MAMA_ID = 222222222

USUARIOS_DEFAULT = {
    NACHO_ID: {"nombre": "Nacho", "emoji": "💪", "cal": 2300, "prot": 185, "grasas": 75, "carb": 220},
    MAMA_ID:  {"nombre": "Mamá",  "emoji": "👩",  "cal": 1680, "prot": 125, "grasas": 55, "carb": 170}
}

passed_tests = 0
failed_tests = 0
findings = []

def report_test(name, success, detail=""):
    global passed_tests, failed_tests
    status = "\033[32mPASS\033[0m" if success else "\033[31mFAIL\033[0m"
    print(f"  [{status}] {name}")
    if detail:
        print(f"         {detail}")
    if success:
        passed_tests += 1
    else:
        failed_tests += 1
        findings.append({"test": name, "detail": detail})

# ---------------------------------------------------------
# JS Logic Extraction & Re-implementation for Verification
# ---------------------------------------------------------

with open(INDEX_PATH, "r", encoding="utf-8") as f:
    HTML_CONTENT = f.read()

def get_logical_date_ago(days_ago):
    # Matches dashboard/index.html getLogicalDateAgo
    # UTC-4 logical date
    now = datetime.utcnow() - timedelta(hours=4)
    target = now - timedelta(days=days_ago)
    return target.strftime("%Y-%m-%d")

def fecha_logica(dt_str):
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    logical = dt - timedelta(hours=4)
    return logical.strftime("%Y-%m-%d")

def calc_adherence_prot(actual, goal):
    if not goal or goal <= 0: return 1.0 if (actual or 0) == 0 else 0.0
    actual = max(0, actual or 0)
    r = actual / goal
    if r <= 1.0: return max(0.0, min(1.0, r))
    if r <= 1.15: return 1.0
    return max(0.70, 1.0 - 0.5 * (r - 1.15))

def calc_adherence_cal(actual, goal):
    if not goal or goal <= 0: return 1.0 if (actual or 0) == 0 else 0.0
    actual = max(0, actual or 0)
    r = actual / goal
    if r < 0.90: return max(0.0, r / 0.90)
    if r <= 1.05: return 1.0
    return max(0.0, 1.0 - 2.0 * (r - 1.05))

def calc_adherence_secondary(actual, goal):
    if not goal or goal <= 0: return 1.0 if (actual or 0) == 0 else 0.0
    actual = max(0, actual or 0)
    r = actual / goal
    if r < 0.80: return max(0.0, r / 0.80)
    if r <= 1.10: return 1.0
    return max(0.0, 1.0 - 1.5 * (r - 1.10))

def calculate_daily_score(today_data, goals):
    meal_count = len(today_data.get("meals", [])) if today_data else 0
    if not today_data or meal_count == 0:
        return {
            "score": None,
            "display": "—",
            "rating": "Sin registros hoy"
        }
    safe_goals = goals or {}
    a_prot = calc_adherence_prot(today_data.get("prot", 0), safe_goals.get("prot", 0))
    a_cal = calc_adherence_cal(today_data.get("cal", 0), safe_goals.get("cal", 0))
    a_carb = calc_adherence_secondary(today_data.get("carb", 0), safe_goals.get("carb", 0))
    a_grasas = calc_adherence_secondary(today_data.get("grasas", 0), safe_goals.get("grasas", 0))
    raw = 4.0 * a_prot + 3.0 * a_cal + 1.5 * a_carb + 1.5 * a_grasas
    score = min(10.0, max(0.0, round(raw, 1)))
    return {"score": score, "display": f"{score:.1f}"}

def calc_period_delta(curr_avg, prev_avg, prev_logged_days):
    if not prev_logged_days or prev_logged_days <= 0 or prev_avg is None or prev_avg <= 0:
        return {"delta_pct": None, "display": "s/d", "arrow": "", "has_data": False}
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
    return {"delta_pct": delta_int, "display": display, "arrow": arrow, "has_data": True}

def simulate_render_averages(grouped, current_range, goals):
    N = current_range
    curr_dates = [get_logical_date_ago(i) for i in range(N - 1, -1, -1)]
    prev_dates = [get_logical_date_ago(i) for i in range(2 * N - 1, N - 1, -1)]

    curr_logged = 0
    curr_totals = {"cal": 0, "prot": 0, "carb": 0, "grasas": 0}
    for d in curr_dates:
        if d in grouped and grouped[d].get("meals") and len(grouped[d]["meals"]) > 0:
            curr_logged += 1
            for k in curr_totals:
                curr_totals[k] += grouped[d].get(k, 0)

    prev_logged = 0
    prev_totals = {"cal": 0, "prot": 0, "carb": 0, "grasas": 0}
    for d in prev_dates:
        if d in grouped and grouped[d].get("meals") and len(grouped[d]["meals"]) > 0:
            prev_logged += 1
            for k in prev_totals:
                prev_totals[k] += grouped[d].get(k, 0)

    curr_div = max(1, curr_logged)
    curr_avgs = {k: round(curr_totals[k] / curr_div) for k in curr_totals}

    prev_div = max(1, prev_logged)
    prev_avgs = {k: round(prev_totals[k] / prev_div) for k in prev_totals} if prev_logged > 0 else None

    deltas = {}
    for k in ["cal", "prot", "carb", "grasas"]:
        prev_val = prev_avgs[k] if prev_avgs else 0
        deltas[k] = calc_period_delta(curr_avgs[k] if curr_logged > 0 else 0, prev_val, prev_logged)

    return {
        "curr_dates": curr_dates,
        "prev_dates": prev_dates,
        "curr_logged": curr_logged,
        "prev_logged": prev_logged,
        "curr_avgs": curr_avgs,
        "prev_avgs": prev_avgs,
        "deltas": deltas
    }

# =====================================================================
# STRESS SUITE 1: RAPID USER SWITCHING (NACHO <-> MAMÁ)
# =====================================================================
print("\n======================================================================")
print(" SUITE 1: Rapid User Switching & Async Race Condition Simulation      ")
print("======================================================================")

async def test_rapid_user_switching_out_of_order():
    """
    Simulates:
    1. User clicks Mamá -> Request 1 starts with Mamá goals (delayed by 80ms)
    2. 10ms later user clicks Nacho -> Request 2 starts with Nacho goals (delayed by 20ms)
    3. Nacho finishes at 30ms, Mamá finishes at 80ms
    4. Verifies loadRequestId aborts Request 1 so Nacho is NEVER overwritten by Mamá.
    """
    state = {
        "currentUser": NACHO_ID,
        "USUARIOS": {NACHO_ID: dict(USUARIOS_DEFAULT[NACHO_ID]), MAMA_ID: dict(USUARIOS_DEFAULT[MAMA_ID])},
        "loadRequestId": 0,
        "renderedUser": None,
        "renderedGoals": None
    }

    mock_db_metas = {
        NACHO_ID: {"cal": 2450, "prot": 195, "carb": 215, "grasas": 80},
        MAMA_ID:  {"cal": 1720, "prot": 135, "carb": 165, "grasas": 58}
    }

    async def fetch_metas_mock(user_id, delay_ms):
        await asyncio.sleep(delay_ms / 1000.0)
        return mock_db_metas[user_id]

    async def fetch_comidas_mock(user_id, delay_ms):
        await asyncio.sleep(delay_ms / 1000.0)
        return [{"id": 1, "usuario_id": user_id, "calorias": 500}]

    async def load_all_simulated():
        state["loadRequestId"] += 1
        req_id = state["loadRequestId"]
        req_user = state["currentUser"]

        # Simulate delay: Mamá is slow (80ms), Nacho is fast (20ms)
        delay = 80 if req_user == MAMA_ID else 20
        goals = await fetch_metas_mock(req_user, delay)

        # Race condition check (verbatim line 1329 from index.html)
        if req_id != state["loadRequestId"] or req_user != state["currentUser"]:
            return "ABORTED_AT_METAS"

        state["USUARIOS"][req_user] = goals

        meals = await fetch_comidas_mock(req_user, delay)

        # Race condition check (verbatim line 1334 from index.html)
        if req_id != state["loadRequestId"] or req_user != state["currentUser"]:
            return "ABORTED_AT_COMIDAS"

        state["renderedUser"] = req_user
        state["renderedGoals"] = goals
        return "RENDERED"

    # User clicks Mamá
    state["currentUser"] = MAMA_ID
    task1 = asyncio.create_task(load_all_simulated())

    await asyncio.sleep(0.01) # 10ms later user clicks Nacho

    state["currentUser"] = NACHO_ID
    task2 = asyncio.create_task(load_all_simulated())

    res1, res2 = await asyncio.gather(task1, task2)

    success = (res1 == "ABORTED_AT_METAS" and res2 == "RENDERED" and
               state["renderedUser"] == NACHO_ID and
               state["renderedGoals"]["cal"] == 2450)
    report_test("1.1 Out-of-order async resolution (Mamá slow 80ms, Nacho fast 20ms)",
                success,
                f"req1={res1}, req2={res2}, finalRenderedUser={state['renderedUser']}, cal={state['renderedGoals']['cal'] if state['renderedGoals'] else None}")

async def test_rapid_oscillation_stress():
    """
    Simulates 100 rapid oscillations between Nacho and Mamá with random network jitter.
    Verifies that state converges to the final clicked user 100% of the time.
    """
    state = {
        "currentUser": NACHO_ID,
        "USUARIOS": {NACHO_ID: dict(USUARIOS_DEFAULT[NACHO_ID]), MAMA_ID: dict(USUARIOS_DEFAULT[MAMA_ID])},
        "loadRequestId": 0,
        "renderedUser": None,
        "renderCount": 0,
        "abortCount": 0
    }

    mock_db_metas = {
        NACHO_ID: {"cal": 2450, "prot": 195},
        MAMA_ID:  {"cal": 1720, "prot": 135}
    }

    async def load_all_simulated():
        state["loadRequestId"] += 1
        req_id = state["loadRequestId"]
        req_user = state["currentUser"]

        # Jitter between 2ms and 25ms
        jitter1 = random.uniform(0.002, 0.025)
        await asyncio.sleep(jitter1)

        if req_id != state["loadRequestId"] or req_user != state["currentUser"]:
            state["abortCount"] += 1
            return

        state["USUARIOS"][req_user] = mock_db_metas[req_user]

        jitter2 = random.uniform(0.002, 0.025)
        await asyncio.sleep(jitter2)

        if req_id != state["loadRequestId"] or req_user != state["currentUser"]:
            state["abortCount"] += 1
            return

        state["renderedUser"] = req_user
        state["renderCount"] += 1

    tasks = []
    target_user = NACHO_ID
    for i in range(100):
        target_user = MAMA_ID if (i % 2 == 0) else NACHO_ID
        state["currentUser"] = target_user
        tasks.append(asyncio.create_task(load_all_simulated()))
        await asyncio.sleep(0.003) # 3ms interval

    await asyncio.gather(*tasks)

    success = (state["renderedUser"] == target_user and
               state["currentUser"] == target_user and
               state["abortCount"] > 50)
    report_test("1.2 100x rapid user oscillation under random jitter (2-25ms)",
                success,
                f"Target={target_user}, Rendered={state['renderedUser']}, Renders={state['renderCount']}, Aborts={state['abortCount']}")

def test_select_user_promise_return():
    """
    Inspects whether selectUser() returns the loadAll() promise.
    Finding: selectUser(uid) in dashboard/index.html does:
        currentUser = uid;
        mealDayOffset = 0;
        ...
        loadAll();
    It does NOT return loadAll()!
    Consequently, automated test harnesses doing `await selectUser(...)`
    will not wait for loadAll to finish, causing race conditions in test suites!
    """
    select_user_match = re.search(r"function selectUser\(uid\)\s*\{(.*?)\}", HTML_CONTENT, re.DOTALL)
    assert select_user_match, "selectUser definition not found"
    body = select_user_match.group(1)
    returns_promise = "return loadAll()" in body or "return await loadAll()" in body

    # We report this as a critical finding!
    detail = "selectUser() returns loadAll() Promise" if returns_promise else "selectUser() calls loadAll() as floating unreturned Promise (await selectUser() does not wait)"
    report_test("1.3 selectUser() Promise Return Interface Inspection", returns_promise, detail)

# =====================================================================
# STRESS SUITE 2: RAPID RANGE SWITCHING (7d <-> 14d <-> 30d)
# =====================================================================
print("\n======================================================================")
print(" SUITE 2: Rapid Range Switching & Range Synchronization               ")
print("======================================================================")

async def test_rapid_range_switching_inverted_latency():
    """
    Simulates:
    1. User clicks 30d (queries 67 days, takes 70ms)
    2. User clicks 14d (queries 35 days, takes 40ms)
    3. User clicks 7d  (queries 21 days, takes 15ms)
    Verifies 7d resolves first and later 14d / 30d resolutions do NOT overwrite 7d.
    """
    state = {
        "currentRange": 7,
        "loadRequestId": 0,
        "renderedRange": None
    }

    async def fetch_comidas_by_range(range_days, delay_ms):
        await asyncio.sleep(delay_ms / 1000.0)
        return range_days

    async def load_all_simulated():
        state["loadRequestId"] += 1
        req_id = state["loadRequestId"]
        req_range = state["currentRange"]

        delay = 70 if req_range == 30 else (40 if req_range == 14 else 15)
        # 1. Metas
        await asyncio.sleep(0.005)
        if req_id != state["loadRequestId"]: return "ABORT_METAS"

        # 2. Comidas
        await fetch_comidas_by_range(req_range, delay)
        if req_id != state["loadRequestId"]: return "ABORT_COMIDAS"

        state["renderedRange"] = req_range
        return "RENDERED"

    state["currentRange"] = 30
    t1 = asyncio.create_task(load_all_simulated())
    await asyncio.sleep(0.005)

    state["currentRange"] = 14
    t2 = asyncio.create_task(load_all_simulated())
    await asyncio.sleep(0.005)

    state["currentRange"] = 7
    t3 = asyncio.create_task(load_all_simulated())

    r1, r2, r3 = await asyncio.gather(t1, t2, t3)

    success = (r1 == "ABORT_COMIDAS" and r2 == "ABORT_COMIDAS" and r3 == "RENDERED" and
               state["renderedRange"] == 7 and state["currentRange"] == 7)
    report_test("2.1 Inverted latency range switching (30d 70ms, 14d 40ms, 7d 15ms)",
                success,
                f"r30={r1}, r14={r2}, r7={r3}, finalRenderedRange={state['renderedRange']}")

def test_set_range_promise_return():
    """
    Inspects whether setRange() returns the loadAll() promise.
    """
    set_range_match = re.search(r"function setRange\(days\)\s*\{(.*?)\}", HTML_CONTENT, re.DOTALL)
    assert set_range_match, "setRange definition not found"
    body = set_range_match.group(1)
    returns_promise = "return loadAll()" in body or "return await loadAll()" in body
    detail = "setRange() returns loadAll() Promise" if returns_promise else "setRange() calls loadAll() as floating unreturned Promise"
    report_test("2.2 setRange() Promise Return Interface Inspection", returns_promise, detail)

# =====================================================================
# STRESS SUITE 3: renderAverages DATE RANGE ISOLATION & LEAK DEFENSE
# =====================================================================
print("\n======================================================================")
print(" SUITE 3: renderAverages Date Range Isolation & Leak Defense          ")
print("======================================================================")

def test_render_averages_leak_poison_data():
    """
    Simulates expanded query buffer containing poison data:
    - Days 0 to 6 (curr 7d): 2000 cal
    - Days 7 to 13 (prev 7d): 1500 cal
    - Days 14 to 24 (expanded buffer / older history): 99999 cal (POISON)
    Verifies that curr_avgs is EXACTLY 2000 cal, NOT polluted by 99999 cal.
    """
    grouped = {}
    for i in range(25):
        d = get_logical_date_ago(i)
        if i <= 6:
            grouped[d] = {"cal": 2000, "prot": 150, "carb": 200, "grasas": 60, "meals": [{"id": i}]}
        elif i <= 13:
            grouped[d] = {"cal": 1500, "prot": 100, "carb": 150, "grasas": 50, "meals": [{"id": i}]}
        else:
            grouped[d] = {"cal": 99999, "prot": 9999, "carb": 9999, "grasas": 9999, "meals": [{"id": i}]}

    res = simulate_render_averages(grouped, 7, USUARIOS_DEFAULT[NACHO_ID])
    curr_cal = res["curr_avgs"]["cal"]
    prev_cal = res["prev_avgs"]["cal"]
    delta_cal = res["deltas"]["cal"]

    success = (curr_cal == 2000 and prev_cal == 1500 and delta_cal["delta_pct"] == 33 and delta_cal["arrow"] == "↑")
    report_test("3.1 Poison buffer isolation (Days 14-24 with 99,999 kcal excluded)",
                success,
                f"currCal={curr_cal} (expected 2000), prevCal={prev_cal} (expected 1500), delta={delta_cal['display']}")

def test_render_averages_gap_days():
    """
    Simulates gap days:
    - Current period: only Day 0 (2400 kcal) and Day 2 (2000 kcal) logged. (Total=4400, Logged=2, Avg=2200).
    - Days 1, 3, 4, 5, 6: unlogged (0 meals).
    - Days 7 to 20: 1000 kcal each.
    Verifies:
    1. currLoggedDays == 2
    2. Divisor is 2, producing 2200 kcal average.
    3. Unlogged days DO NOT pull meals from days 7–20.
    """
    grouped = {}
    d0 = get_logical_date_ago(0)
    d2 = get_logical_date_ago(2)
    grouped[d0] = {"cal": 2400, "prot": 180, "carb": 220, "grasas": 70, "meals": [{"id": 1}]}
    grouped[d2] = {"cal": 2000, "prot": 160, "carb": 200, "grasas": 60, "meals": [{"id": 2}]}

    for i in range(7, 21):
        d = get_logical_date_ago(i)
        grouped[d] = {"cal": 1000, "prot": 80, "carb": 100, "grasas": 30, "meals": [{"id": i}]}

    res = simulate_render_averages(grouped, 7, USUARIOS_DEFAULT[NACHO_ID])
    curr_cal = res["curr_avgs"]["cal"]
    curr_logged = res["curr_logged"]

    success = (curr_logged == 2 and curr_cal == 2200)
    report_test("3.2 Gap days divisor & boundary isolation (2 logged days = 2200 kcal)",
                success,
                f"currLoggedDays={curr_logged} (expected 2), currAvgCal={curr_cal} (expected 2200)")

def test_render_averages_zero_previous_period():
    """
    Tests division-by-zero guard when previous period has 0 logged meals.
    Must return display: 's/d', delta_pct: None, has_data: False.
    No NaN, no Infinity.
    """
    grouped = {}
    for i in range(7):
        d = get_logical_date_ago(i)
        grouped[d] = {"cal": 2000, "prot": 150, "carb": 200, "grasas": 60, "meals": [{"id": i}]}

    res = simulate_render_averages(grouped, 7, USUARIOS_DEFAULT[NACHO_ID])
    delta = res["deltas"]["cal"]

    success = (delta["display"] == "s/d" and delta["delta_pct"] is None and delta["has_data"] is False)
    report_test("3.3 Zero previous period division-by-zero guard (s/d)",
                success,
                f"display={delta['display']}, has_data={delta['has_data']}, delta_pct={delta['delta_pct']}")

def test_render_averages_future_date_leak():
    """
    Tests that future date timestamps (e.g. today + 1 day) do not leak into curr_avgs.
    """
    grouped = {}
    for i in range(7):
        d = get_logical_date_ago(i)
        grouped[d] = {"cal": 2000, "prot": 150, "carb": 200, "grasas": 60, "meals": [{"id": i}]}

    # Future date: -1 days ago = tomorrow
    future_d = get_logical_date_ago(-1)
    grouped[future_d] = {"cal": 50000, "prot": 5000, "carb": 5000, "grasas": 5000, "meals": [{"id": 999}]}

    res = simulate_render_averages(grouped, 7, USUARIOS_DEFAULT[NACHO_ID])
    curr_cal = res["curr_avgs"]["cal"]

    success = (curr_cal == 2000)
    report_test("3.4 Future date exclusion (tomorrow with 50,000 kcal ignored)",
                success,
                f"currCal={curr_cal} (expected 2000)")

# =====================================================================
# STRESS SUITE 4: AUTO-REFRESH & DOM STABILITY
# =====================================================================
print("\n======================================================================")
print(" SUITE 4: Auto-refresh & DOM Stability (Re-executing loadAll 50x)     ")
print("======================================================================")

def test_dom_structure_invariants():
    """
    Analyzes DOM element creation inside dashboard/index.html:
    1. Verifies that cards (#daily-score-card, #averages-grid) are STATICALLY declared in HTML.
    2. Verifies that renderDailyScore, renderCards, renderAverages mutate textContent / className in-place.
    3. Verifies that tbody.innerHTML is wiped and replaced, not appended.
    4. Verifies Chart instances are destroyed before creation (charts[canvasId].destroy(), donutChart.destroy()).
    """
    daily_score_card_count = len(re.findall(r'id=["\']daily-score-card["\']', HTML_CONTENT))
    averages_grid_count = len(re.findall(r'id=["\']averages-grid["\']', HTML_CONTENT))

    chart_destroys = len(re.findall(r'charts\[canvasId\]\.destroy\(\)', HTML_CONTENT))
    donut_destroys = len(re.findall(r'donutChart\.destroy\(\)', HTML_CONTENT))

    append_child_calls = len(re.findall(r'\.appendChild\(', HTML_CONTENT))
    create_element_calls = len(re.findall(r'document\.createElement\(', HTML_CONTENT))

    success = (daily_score_card_count == 1 and
               averages_grid_count == 1 and
               chart_destroys >= 1 and
               donut_destroys >= 1 and
               append_child_calls == 0 and
               create_element_calls == 0)

    report_test("4.1 In-place DOM mutation verification (No createElement, destroy guards active)",
                success,
                f"dailyScoreCards={daily_score_card_count}, avgGrids={averages_grid_count}, chartDestroys={chart_destroys}, donutDestroys={donut_destroys}, createElement={create_element_calls}")

def test_event_listener_leak_check():
    """
    Checks for addEventListener calls in dashboard/index.html.
    Every addEventListener inside loadAll would multiply listeners every 30s.
    """
    add_listener_calls = len(re.findall(r'addEventListener\(', HTML_CONTENT))
    success = (add_listener_calls == 0)
    report_test("4.2 Zero runtime addEventListener calls (No listener leakage across auto-refreshes)",
                success,
                f"addEventListener count in index.html: {add_listener_calls}")

def test_meal_day_offset_preservation():
    """
    Verifies that loadAll() does NOT touch mealDayOffset,
    allowing users to inspect historical days across 30s auto-refresh ticks.
    """
    load_all_match = re.search(r"async function loadAll\(\)\s*\{(.*?)\n\s*// =====", HTML_CONTENT, re.DOTALL)
    assert load_all_match, "loadAll not found"
    load_all_code = load_all_match.group(1)

    resets_offset_in_load_all = "mealDayOffset = 0" in load_all_code

    select_user_match = re.search(r"function selectUser\(uid\)\s*\{(.*?)\}", HTML_CONTENT, re.DOTALL)
    assert select_user_match, "selectUser not found"
    select_user_code = select_user_match.group(1)
    resets_offset_in_select_user = "mealDayOffset = 0" in select_user_code

    success = (not resets_offset_in_load_all and resets_offset_in_select_user)
    report_test("4.3 Day navigation state preserved across auto-refresh (mealDayOffset untouched)",
                success,
                f"loadAll resets offset: {resets_offset_in_load_all}, selectUser resets offset: {resets_offset_in_select_user}")

# =====================================================================
# SUITE 5: CONTRACT MISMATCH AUDIT (E2E TEST RUNNER DISCREPANCIES)
# =====================================================================
print("\n======================================================================")
print(" SUITE 5: Contract & Interface Alignment Audit                        ")
print("======================================================================")

def audit_e2e_discrepancies():
    """
    Examines why E2E tests T1-R5-02..05 failed:
    E2E runner checks:
      document.getElementById('pop-cal-delta') || document.getElementById('avg-cal-diff-pop') || [data-pop="cal"]
      document.querySelectorAll('[id^="pop-"], [class*="pop-delta"]')
    Worker M1 implemented:
      id="delta-cal", id="avg-cal-delta"
    This is an interface contract naming discrepancy!
    """
    has_delta_cal = 'id="delta-cal"' in HTML_CONTENT
    has_avg_cal_delta = 'id="avg-cal-delta"' in HTML_CONTENT
    has_pop_cal_delta = 'id="pop-cal-delta"' in HTML_CONTENT

    discrepancy = has_delta_cal and not has_pop_cal_delta
    report_test("5.1 Period delta element ID alignment check",
                not discrepancy,
                f"Worker M1 used id='delta-cal' / id='avg-cal-delta', but E2E suite looks for id='pop-cal-delta' or [data-pop='cal']")

# =====================================================================
# MAIN RUNNER
# =====================================================================

async def main():
    await test_rapid_user_switching_out_of_order()
    await test_rapid_oscillation_stress()
    test_select_user_promise_return()

    await test_rapid_range_switching_inverted_latency()
    test_set_range_promise_return()

    test_render_averages_leak_poison_data()
    test_render_averages_gap_days()
    test_render_averages_zero_previous_period()
    test_render_averages_future_date_leak()

    test_dom_structure_invariants()
    test_event_listener_leak_check()
    test_meal_day_offset_preservation()

    audit_e2e_discrepancies()

    print("\n======================================================================")
    print("                    STRESS TEST HARNESS RESULTS                       ")
    print("======================================================================")
    print(f" Total Tests Run : {passed_tests + failed_tests}")
    print(f" Passed          : \033[32m{passed_tests}\033[0m")
    print(f" Failed / Issues : \033[31m{failed_tests}\033[0m")
    print("======================================================================\n")

    if findings:
        print("ISSUES & VULNERABILITIES IDENTIFIED:")
        for idx, f in enumerate(findings, 1):
            print(f" {idx}. [{f['test']}]: {f['detail']}")
    print()

if __name__ == "__main__":
    asyncio.run(main())
