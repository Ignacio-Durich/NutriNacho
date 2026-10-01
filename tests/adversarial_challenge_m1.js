/**
 * NutriNacho M1 Adversarial Challenge & Empirical Verification Suite
 * Author: challenger_m1_1
 * 
 * Directly tests dashboard/index.html across all 4 mandatory areas:
 * 1. Daily Score with zero intake (all 0s)
 * 2. Daily Score with 200% protein and 200% calories (penalty curves & floors)
 * 3. Period Deltas with 0 meals in previous period (division-by-zero guards)
 * 4. Supabase metas empty response vs error response (Nacho & Mamá fallback)
 * Plus Architectural & Contract Failure Probes (async selectUser & DOM IDs)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { createMeal, createNachoPerfectDay, createNachoTwoPeriodSet } = require('./fixtures/comidas_fixtures');

const results = [];
let passCount = 0;
let failCount = 0;

async function runProbe(name, fn) {
    try {
        await fn();
        passCount++;
        results.push({ name, status: 'PASS', error: null });
        console.log(`  ✓ [PASS] ${name}`);
    } catch (err) {
        failCount++;
        results.push({ name, status: 'FAIL', error: err.message });
        console.log(`  ✗ [FAIL] ${name}`);
        console.log(`     Error: ${err.message}`);
    }
}

async function runAllChallenges() {
    console.log('\n======================================================================');
    console.log('       NutriNacho M1 Adversarial Challenge Suite (challenger_m1_1)');
    console.log('======================================================================\n');

    // ------------------------------------------------------------------
    // CHALLENGE 1: DAILY SCORE WITH ZERO INTAKE (ALL 0s)
    // ------------------------------------------------------------------
    console.log('▶ [Challenge 1] Daily Score with Zero Intake Probes');
    console.log('─'.repeat(70));

    await runProbe('1.1 Zero meals today (null todayData) returns "—/10" without NaN/Infinity', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcScore = env.getGlobal('calculateDailyScore');
        assert(typeof calcScore === 'function', 'calculateDailyScore must be defined');

        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const res = calcScore(null, goals);

        assert.strictEqual(res.score, null, 'Score must be null when todayData is null');
        assert.strictEqual(res.display, '—', 'Display must be "—"');
        assert.strictEqual(res.rating, 'Sin registros hoy', 'Rating must be "Sin registros hoy"');
        assert.strictEqual(res.is_empty, true, 'is_empty must be true');
        assert(!Number.isNaN(res.score), 'Score must not be NaN');
    });

    await runProbe('1.2 Zero meals today (empty meals array) returns "—/10" and neutral badge', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcScore = env.getGlobal('calculateDailyScore');
        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const res = calcScore({ cal: 0, prot: 0, carb: 0, grasas: 0, meals: [] }, goals);

        assert.strictEqual(res.score, null, 'Score must be null when meals array is empty');
        assert.strictEqual(res.display, '—', 'Display must be "—"');
        assert.strictEqual(res.rating, 'Sin registros hoy', 'Rating must be "Sin registros hoy"');
        assert(res.badgeClass.includes('slate'), 'Badge must use neutral slate colors');
    });

    await runProbe('1.3 Zero intake but 1 meal logged (e.g. coffee) returns 0.0 without NaN/Infinity', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcScore = env.getGlobal('calculateDailyScore');
        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const res = calcScore({
            cal: 0, prot: 0, carb: 0, grasas: 0,
            meals: [{ comida: 'Café negro', calorias: 0, proteina_g: 0, carbohidratos_g: 0, grasas_g: 0 }]
        }, goals);

        assert.strictEqual(res.score, 0.0, 'Score must be 0.0 when 1 meal logged with 0 macros');
        assert.strictEqual(res.display, '0.0', 'Display must be "0.0"');
        assert.strictEqual(res.rating, 'Ajustar', 'Rating must be "Ajustar"');
        assert(!Number.isNaN(res.score), 'Score must not be NaN');
        assert(Number.isFinite(res.score), 'Score must be finite');
    });

    await runProbe('1.4 Zero-target guard (all goals 0 or undefined) produces 0.0 without NaN/Infinity', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcScore = env.getGlobal('calculateDailyScore');
        const res = calcScore(
            { cal: 500, prot: 40, carb: 50, grasas: 15, meals: [{ comida: 'Snack' }] },
            { cal: 0, prot: 0, carb: 0, grasas: 0 }
        );

        assert(!Number.isNaN(res.score), 'Score must not be NaN when goals are 0');
        assert(Number.isFinite(res.score), 'Score must be finite when goals are 0');
        assert.strictEqual(res.score, 0.0, 'Score must evaluate to 0.0');
        assert.strictEqual(res.display, '0.0', 'Display must be "0.0"');
    });

    // ------------------------------------------------------------------
    // CHALLENGE 2: 200% PROTEIN AND 200% CALORIES (CURVES & FLOORS)
    // ------------------------------------------------------------------
    console.log('\n▶ [Challenge 2] 200% Protein & 200% Calories Curves & Floors');
    console.log('─'.repeat(70));

    await runProbe('2.1 Protein surplus curve: floors at 0.70 (2.8 pts) at 200% and 300% protein', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcProt = env.getGlobal('calcAdherenceProt');
        assert(typeof calcProt === 'function', 'calcAdherenceProt must be defined');

        // Plateau at 100% and 115%
        assert.strictEqual(calcProt(185, 185), 1.0, '100% prot must be 1.0');
        assert.strictEqual(calcProt(185 * 1.15, 185), 1.0, '115% prot must be 1.0');

        // Mild surplus at 120%
        const a120 = calcProt(185 * 1.20, 185);
        assert(Math.abs(a120 - 0.975) < 0.001, `120% prot expected ~0.975, got ${a120}`);

        // 200% protein: 1.0 - 0.5 * (2.0 - 1.15) = 1.0 - 0.425 = 0.575 -> FLOORED at 0.70
        const a200 = calcProt(185 * 2.00, 185);
        assert.strictEqual(a200, 0.70, `200% prot must be floored at 0.70, got ${a200}`);

        // 300% protein: must still floor at 0.70
        const a300 = calcProt(185 * 3.00, 185);
        assert.strictEqual(a300, 0.70, `300% prot must be floored at 0.70, got ${a300}`);
    });

    await runProbe('2.2 Calorie surplus curve: drops with slope 2.0 and floors at 0.0 (no negative pts)', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcCal = env.getGlobal('calcAdherenceCal');
        assert(typeof calcCal === 'function', 'calcAdherenceCal must be defined');

        // Tolerance up to 105%
        assert.strictEqual(calcCal(2300, 2300), 1.0, '100% cal must be 1.0');
        assert.strictEqual(calcCal(2300 * 1.05, 2300), 1.0, '105% cal must be 1.0');

        // 110% cal: 1.0 - 2.0 * (1.10 - 1.05) = 0.90
        const a110 = calcCal(2300 * 1.10, 2300);
        assert(Math.abs(a110 - 0.90) < 0.001, `110% cal expected ~0.90, got ${a110}`);

        // 150% cal: 1.0 - 2.0 * (1.50 - 1.05) = 0.10
        const a150 = calcCal(2300 * 1.50, 2300);
        assert(Math.abs(a150 - 0.10) < 0.001, `150% cal expected ~0.10, got ${a150}`);

        // 200% cal: 1.0 - 2.0 * 0.95 = -0.90 -> CLAMPED at 0.0
        const a200 = calcCal(2300 * 2.00, 2300);
        assert.strictEqual(a200, 0.0, `200% cal must floor at 0.0, got ${a200}`);

        // 300% cal: must remain 0.0
        const a300 = calcCal(2300 * 3.00, 2300);
        assert.strictEqual(a300, 0.0, `300% cal must remain 0.0, got ${a300}`);
    });

    await runProbe('2.3 Daily score with 200% protein, 200% cal, 100% carb & fats evaluates to 5.8', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcScore = env.getGlobal('calculateDailyScore');
        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const res = calcScore({
            cal: 4600, prot: 370, carb: 220, grasas: 75,
            meals: [{ comida: 'Surplus meal 1' }, { comida: 'Surplus meal 2' }]
        }, goals);

        // Expected pts: 4.0*0.70 (2.8) + 3.0*0.0 (0.0) + 1.5*1.0 (1.5) + 1.5*1.0 (1.5) = 5.8
        assert.strictEqual(res.score, 5.8, `Expected score 5.8, got ${res.score}`);
        assert.strictEqual(res.display, '5.8', 'Display must be 5.8');
        assert.strictEqual(res.rating, 'Ajustar', 'Rating for 5.8 must be Ajustar');
        assert.strictEqual(res.points.prot, '2.8', 'Prot points must be 2.8');
        assert.strictEqual(res.points.cal, '0.0', 'Cal points must be 0.0');
    });

    await runProbe('2.4 Daily score with 200% across all 4 macros floors at protein minimum 2.8', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcScore = env.getGlobal('calculateDailyScore');
        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const res = calcScore({
            cal: 4600, prot: 370, carb: 440, grasas: 150,
            meals: [{ comida: 'Massive meal' }]
        }, goals);

        // Expected: 2.8 + 0.0 + 0.0 + 0.0 = 2.8
        assert.strictEqual(res.score, 2.8, `Expected score 2.8, got ${res.score}`);
        assert.strictEqual(res.display, '2.8', 'Display must be 2.8');
        assert.strictEqual(res.rating, 'Ajustar', 'Rating must be Ajustar');
    });

    // ------------------------------------------------------------------
    // CHALLENGE 3: PERIOD DELTAS WITH 0 MEALS IN PREVIOUS PERIOD
    // ------------------------------------------------------------------
    console.log('\n▶ [Challenge 3] Period Deltas Division by Zero Probes');
    console.log('─'.repeat(70));

    await runProbe('3.1 prev_logged_days = 0 returns "s/d" without NaN% or Infinity%', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcDelta = env.getGlobal('calc_period_delta');
        assert(typeof calcDelta === 'function', 'calc_period_delta must be defined');

        const res = calcDelta(2100, 0, 0);
        assert.strictEqual(res.display, 's/d', 'Display must be "s/d"');
        assert.strictEqual(res.has_data, false, 'has_data must be false');
        assert.strictEqual(res.delta_pct, null, 'delta_pct must be null');
        assert(!res.display.includes('NaN'), 'Display must not contain NaN');
        assert(!res.display.includes('Infinity'), 'Display must not contain Infinity');
    });

    await runProbe('3.2 prev_avg = 0 with prev_logged_days > 0 safely returns "s/d"', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcDelta = env.getGlobal('calc_period_delta');

        const res = calcDelta(2100, 0, 7);
        assert.strictEqual(res.display, 's/d', 'Display must be "s/d" when prev_avg is 0');
        assert.strictEqual(res.has_data, false, 'has_data must be false');
    });

    await runProbe('3.3 prev_avg = null or undefined safely returns "s/d"', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcDelta = env.getGlobal('calc_period_delta');

        const res1 = calcDelta(2100, null, 7);
        assert.strictEqual(res1.display, 's/d');
        const res2 = calcDelta(2100, undefined, 7);
        assert.strictEqual(res2.display, 's/d');
    });

    await runProbe('3.4 Identical periods (2000 vs 2000) returns "0%" and arrow "→"', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcDelta = env.getGlobal('calc_period_delta');

        const res = calcDelta(2000, 2000, 7);
        assert.strictEqual(res.display, '0%');
        assert.strictEqual(res.arrow, '→');
        assert.strictEqual(res.delta_pct, 0);
        assert.strictEqual(res.has_data, true);
    });

    await runProbe('3.5 200% increase (3000 vs 1000) formats as "+200%" and arrow "↑"', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcDelta = env.getGlobal('calc_period_delta');

        const res = calcDelta(3000, 1000, 7);
        assert.strictEqual(res.display, '+200%');
        assert.strictEqual(res.arrow, '↑');
        assert.strictEqual(res.delta_pct, 200);
    });

    // ------------------------------------------------------------------
    // CHALLENGE 4: SUPABASE METAS EMPTY VS ERROR FALLBACK
    // ------------------------------------------------------------------
    console.log('\n▶ [Challenge 4] Supabase metas Fallback Probes');
    console.log('─'.repeat(70));

    await runProbe('4.1 Empty metas response falls back cleanly for Nacho and Mamá', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: { metas: [], comidas: [] }
        });
        env.runScript();
        const fetchMetas = env.getGlobal('fetchMetas');

        const nachoGoals = await fetchMetas(NACHO_ID);
        assert.strictEqual(nachoGoals.cal, 2300, 'Nacho cal fallback must be 2300');
        assert.strictEqual(nachoGoals.prot, 185, 'Nacho prot fallback must be 185');
        assert.strictEqual(nachoGoals.is_fallback, true, 'is_fallback must be true');

        const mamaGoals = await fetchMetas(MAMA_ID);
        assert.strictEqual(mamaGoals.cal, 1680, 'Mamá cal fallback must be 1680');
        assert.strictEqual(mamaGoals.prot, 125, 'Mamá prot fallback must be 125');
        assert.strictEqual(mamaGoals.is_fallback, true, 'is_fallback must be true');
    });

    await runProbe('4.2 Error in metas query falls back cleanly for Nacho and Mamá', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                forceError: { message: 'Database connection timeout', code: 'PGRST500' }
            }
        });
        env.runScript();
        const fetchMetas = env.getGlobal('fetchMetas');

        const nachoGoals = await fetchMetas(NACHO_ID);
        assert.strictEqual(nachoGoals.cal, 2300);
        assert.strictEqual(nachoGoals.is_fallback, true);

        const mamaGoals = await fetchMetas(MAMA_ID);
        assert.strictEqual(mamaGoals.cal, 1680);
        assert.strictEqual(mamaGoals.is_fallback, true);
    });

    await runProbe('4.3 Partial metas row with nulls merges with default values', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                metas: [{
                    id: 99,
                    usuario_id: NACHO_ID,
                    calorias: 2500,
                    proteina_g: null, // null should fall back to 185
                    carbohidratos_g: 0, // 0 should fall back to 220
                    grasas_g: 80,
                    fecha_creacion: '2026-09-29T12:00:00Z'
                }]
            }
        });
        env.runScript();
        const fetchMetas = env.getGlobal('fetchMetas');

        const goals = await fetchMetas(NACHO_ID);
        assert.strictEqual(goals.cal, 2500, 'cal should be 2500 from metas');
        assert.strictEqual(goals.prot, 185, 'null prot must fall back to 185');
        assert.strictEqual(goals.carb, 220, '0 carb must fall back to 220');
        assert.strictEqual(goals.grasas, 80, 'grasas should be 80 from metas');
    });

    // ------------------------------------------------------------------
    // CHALLENGE 5: ARCHITECTURAL & REGRESSION DEFECT PROBES
    // ------------------------------------------------------------------
    console.log('\n▶ [Challenge 5] Architectural & Interface Failure Probes');
    console.log('─'.repeat(70));

    await runProbe('5.1 [DEFECT AUDIT] selectUser() return value: is loadAll() promise returned?', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const selectUser = env.getGlobal('selectUser');
        assert(typeof selectUser === 'function', 'selectUser must exist');

        const ret = selectUser(MAMA_ID);
        // If selectUser does not return the promise from loadAll(), ret is undefined!
        const isPromise = ret && typeof ret.then === 'function';
        if (!isPromise) {
            throw new Error(`CRITICAL DEFECT: selectUser() returns ${ret} instead of a Promise. Async callers cannot await loadAll() completion!`);
        }
    });

    await runProbe('5.2 [DEFECT AUDIT] DOM IDs for R5 Period Deltas match TEST_INFRA contract', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();

        // Check if either pop-cal-delta or data-pop="cal" exists
        const popCal = env.document.getElementById('pop-cal-delta') ||
                       env.document.getElementById('avg-cal-diff-pop') ||
                       env.document.querySelector('[data-pop="cal"]');

        const deltaCal = env.document.getElementById('delta-cal') ||
                         env.document.getElementById('avg-cal-delta');

        if (!popCal && deltaCal) {
            throw new Error(`CONTRACT MISMATCH: dashboard/index.html uses id="delta-cal", but E2E test suite (TEST_INFRA.md line 164) requires id="pop-cal-delta" or data-pop="cal"!`);
        }
        assert(popCal, 'Period delta calorie element must match contract');
    });

    await runProbe('5.3 [STATE PRESERVATION] loadAll() preserves mealDayOffset across auto-refreshes', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: { comidas: createNachoPerfectDay(0) }
        });
        env.runScript();
        await env.sandbox.loadAll();

        // User navigates back 1 day (Ayer)
        env.sandbox.mealDayOffset = -1;

        // Auto-refresh fires
        await env.sandbox.loadAll();

        assert.strictEqual(
            env.getGlobal('mealDayOffset'),
            -1,
            'Auto-refresh loadAll() must NOT reset mealDayOffset to 0'
        );
    });

    await runProbe('5.4 [DOM INTEGRATION] R2 Daily Score Card renders into DOM on loadAll()', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                metas: [METAS_FIXTURES.nachoActive],
                comidas: createNachoPerfectDay(0)
            }
        });
        env.runScript();
        await env.sandbox.loadAll();

        const valEl = env.document.getElementById('daily-score-val');
        const badgeEl = env.document.getElementById('daily-score-badge');
        assert(valEl, '#daily-score-val element must exist');
        assert(badgeEl, '#daily-score-badge element must exist');
        assert.strictEqual(valEl.textContent.trim(), '10.0', 'Perfect day must render 10.0 in DOM');
        assert.strictEqual(badgeEl.textContent.trim(), 'Excelente', 'Perfect day must render Excelente badge');
    });

    console.log('\n======================================================================');
    console.log('                 ADVERSARIAL PROBE RESULTS SUMMARY');
    console.log('======================================================================');
    console.log(` Total Probes Executed : ${results.length}`);
    console.log(` Passed                : ${passCount}`);
    console.log(` Failed (Defects Found): ${failCount}`);
    console.log('======================================================================\n');
}

runAllChallenges().catch(err => {
    console.error('Fatal probe execution error:', err);
    process.exit(1);
});
