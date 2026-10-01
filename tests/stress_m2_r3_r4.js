/**
 * NutriNacho Milestone M2 Empirical Stress Test Harness
 * Author: challenger_m2_1
 * 
 * Deeply stress-tests:
 * - Feature R3: Best & Worst Day Highlights (multi-tier tie breaking, 0-meal periods, 1-day periods, 1000-trial property-based fuzzing)
 * - Feature R4: Missing Day Indicators in Charts (all-missing 7/14/30d, alternating/sparse missing days, today missing, moving average non-zero protection, tooltip callbacks, over-goal vs missing color discrimination)
 * - DOM Consistency & Auto-refresh Stability (repeated rendering, child node persistence, no NaN/undefined)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { createMeal } = require('./fixtures/comidas_fixtures');

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
        results.push({ name, status: 'FAIL', error: err.message, stack: err.stack });
        console.log(`  ✗ [FAIL] ${name}`);
        console.log(`     Error: ${err.message}`);
    }
}

// Helper to construct ISO dates relative to today
function getIsoDate(daysAgo) {
    const d = new Date();
    d.setHours(d.getHours() - 4);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
}

async function runAllStressTests() {
    console.log('\n======================================================================');
    console.log('    NutriNacho M2 Empirical Stress Harness (challenger_m2_1)');
    console.log('======================================================================\n');

    // ==================================================================
    // SUITE 1: FEATURE R3 - MULTI-TIER TIE BREAKING & MATHEMATICAL ORACLES
    // ==================================================================
    console.log('▶ [Suite 1] R3: Multi-Day Tie-Breaking & Ranking Oracles');
    console.log('─'.repeat(70));

    await runProbe('1.1 Tie-Break Tier 1: Higher daily score wins regardless of individual macros', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');
        assert(typeof calcBestWorst === 'function', 'calculateBestWorstDays must be defined');

        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const d0 = getIsoDate(0);
        const d1 = getIsoDate(1);

        // Day 0: Score 9.5 (better score), prot 185
        // Day 1: Score 8.0, prot 200 (more protein, but lower overall score)
        const grouped = {
            [d0]: { cal: 2300, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2300, prot: 185 })] },
            [d1]: { cal: 2800, prot: 200, carb: 350, grasas: 90, meals: [createMeal({ cal: 2800, prot: 200 })] }
        };

        const res = calcBestWorst(grouped, 7, goals);
        assert.strictEqual(res.best.date, d0, 'Best day must be d0 due to higher overall score');
        assert.strictEqual(res.worst.date, d1, 'Worst day must be d1 due to lower score');
    });

    await runProbe('1.2 Tie-Break Tier 2: Tied score -> higher protein adherence ratio wins', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');
        const calcDaily = env.getGlobal('calculateDailyScore');

        const goals = { cal: 2000, prot: 200, carb: 200, grasas: 50 };
        const d0 = getIsoDate(0);
        const d1 = getIsoDate(1);

        // Empirically calibrated:
        // Day 0: p=140, c=120, g=40 -> score = 8.4, protRatio = 140/200 = 0.70
        // Day 1: p=150, c=100, g=40 -> score = 8.4, protRatio = 150/200 = 0.75
        const day0Data = { cal: 2000, prot: 140, carb: 120, grasas: 40, meals: [createMeal({ cal: 2000, prot: 140 })] };
        const day1Data = { cal: 2000, prot: 150, carb: 100, grasas: 40, meals: [createMeal({ cal: 2000, prot: 150 })] };

        const s0 = calcDaily(day0Data, goals);
        const s1 = calcDaily(day1Data, goals);
        assert.strictEqual(s0.score, s1.score, `Scores must be strictly equal for tie test (${s0.score} vs ${s1.score})`);

        const grouped = {
            [d0]: day0Data,
            [d1]: day1Data
        };

        const res = calcBestWorst(grouped, 7, goals);
        assert(res.best && res.worst, 'Both best and worst must be identified');
        assert.strictEqual(res.best.date, d1, `Best day must be d1 with higher protein ratio (0.75 vs 0.70)`);
        assert.strictEqual(res.worst.date, d0, 'Worst day must be d0');
    });

    await runProbe('1.3 Tie-Break Tier 3: Tied score AND tied protein ratio -> closer calorie adherence wins', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');
        const calcDaily = env.getGlobal('calculateDailyScore');

        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const d0 = getIsoDate(0);
        const d1 = getIsoDate(1);

        // Both days hit 10.0 score, same 185g protein (ratio 1.0):
        // Day 0: cal 2250 (|cal - 2300| = 50)
        // Day 1: cal 2400 (|cal - 2300| = 100)
        const day0Data = { cal: 2250, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2250, prot: 185 })] };
        const day1Data = { cal: 2400, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2400, prot: 185 })] };

        const s0 = calcDaily(day0Data, goals);
        const s1 = calcDaily(day1Data, goals);
        assert.strictEqual(s0.score, s1.score, 'Scores must be equal');

        const grouped = {
            [d0]: day0Data,
            [d1]: day1Data
        };

        const res = calcBestWorst(grouped, 7, goals);
        assert(res.best && res.worst, 'Both best and worst must be identified');
        assert.strictEqual(res.best.date, d0, `Best day must be d0 (closer cal deviation 50 vs 100)`);
        assert.strictEqual(res.worst.date, d1, 'Worst day must be d1');
    });

    await runProbe('1.4 Tie-Break Tier 4: Equal score, protein ratio, and cal deviation -> more recent date wins', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');

        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const dToday = getIsoDate(0);
        const dYesterday = getIsoDate(1);

        // Exact identical macros on both days
        const grouped = {
            [dYesterday]: { cal: 2300, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2300, prot: 185 })] },
            [dToday]: { cal: 2300, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2300, prot: 185 })] }
        };

        const res = calcBestWorst(grouped, 7, goals);
        assert(res.best && res.worst, 'Both best and worst must be returned');
        assert.strictEqual(res.best.date, dToday, 'Best day must be more recent (dToday)');
        assert.strictEqual(res.worst.date, dYesterday, 'Worst day must be older (dYesterday)');
    });

    await runProbe('1.5 Multi-day tie-break (5 days identical) produces stable best (newest) and worst (oldest)', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');

        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        const grouped = {};
        for (let i = 0; i < 5; i++) {
            const dt = getIsoDate(i);
            grouped[dt] = { cal: 2300, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2300, prot: 185 })] };
        }

        const res = calcBestWorst(grouped, 7, goals);
        assert.strictEqual(res.totalLoggedDays, 5, 'Must report 5 logged days');
        assert.strictEqual(res.best.date, getIsoDate(0), 'Best day must be day 0 (newest)');
        assert.strictEqual(res.worst.date, getIsoDate(4), 'Worst day must be day 4 (oldest)');
    });

    // ==================================================================
    // SUITE 2: FEATURE R3 - ZERO-MEAL & SINGLE-DAY CORNER CASES & DOM
    // ==================================================================
    console.log('\n▶ [Suite 2] R3: Zero-Meal & Single-Day Period Boundaries & DOM State');
    console.log('─'.repeat(70));

    await runProbe('2.1 Period with 0 meals returns totalLoggedDays: 0, best: null, worst: null', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');
        const renderBestWorst = env.getGlobal('renderBestWorstDays');

        const res7 = calcBestWorst({}, 7);
        assert.strictEqual(res7.totalLoggedDays, 0);
        assert.strictEqual(res7.hasEnoughDays, false);
        assert.strictEqual(res7.best, null);
        assert.strictEqual(res7.worst, null);

        const res30 = calcBestWorst({}, 30);
        assert.strictEqual(res30.totalLoggedDays, 0);

        // Render to DOM and verify DOM elements
        renderBestWorst({});
        const doc = env.document;
        const bestDate = doc.getElementById('best-day-date').textContent;
        const bestScore = doc.getElementById('best-day-score').textContent;
        const bestMacros = doc.getElementById('best-day-macros').textContent;
        const worstDate = doc.getElementById('worst-day-date').textContent;
        const worstScore = doc.getElementById('worst-day-score').textContent;
        const worstMacros = doc.getElementById('worst-day-macros').textContent;

        assert.strictEqual(bestDate, '—', 'Best date must show "—"');
        assert.strictEqual(bestScore, '—', 'Best score must show "—"');
        assert(bestMacros.includes('Sin registros'), 'Best macros must state "Sin registros"');
        assert.strictEqual(worstDate, '—', 'Worst date must show "—"');
        assert.strictEqual(worstScore, '—', 'Worst score must show "—"');
        assert(worstMacros.includes('Sin registros'), 'Worst macros must state "Sin registros"');
    });

    await runProbe('2.2 Period with exactly 1 logged day displays Best Day and prompts for Worst Day', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');
        const renderBestWorst = env.getGlobal('renderBestWorstDays');

        const dOnly = getIsoDate(3);
        const grouped = {
            [dOnly]: { cal: 2100, prot: 175, carb: 200, grasas: 70, meals: [createMeal({ cal: 2100, prot: 175 })] }
        };

        const res = calcBestWorst(grouped, 7);
        assert.strictEqual(res.totalLoggedDays, 1);
        assert.strictEqual(res.hasEnoughDays, false);
        assert(res.best !== null, 'Best day must not be null');
        assert.strictEqual(res.worst, null, 'Worst day must be null when only 1 day logged');
        assert.strictEqual(res.best.date, dOnly);

        // Check DOM rendering
        renderBestWorst(grouped);
        const doc = env.document;
        const bestDate = doc.getElementById('best-day-date').textContent;
        const bestScore = doc.getElementById('best-day-score').textContent;
        const worstDate = doc.getElementById('worst-day-date').textContent;
        const worstScore = doc.getElementById('worst-day-score').textContent;
        const worstMacros = doc.getElementById('worst-day-macros').textContent;
        const worstBadge = doc.getElementById('worst-day-badge').textContent;

        assert(bestDate !== '—', 'Best date should display valid date');
        assert(bestScore.includes('/10'), `Best score should show score/10, got: ${bestScore}`);
        assert.strictEqual(worstDate, '—', 'Worst date must be "—"');
        assert.strictEqual(worstScore, '—', 'Worst score must be "—"');
        assert(worstMacros.includes('2 días') || worstMacros.includes('requeridos'), 'Worst macros must indicate 2 days needed');
        assert.strictEqual(worstBadge, 'Día único', 'Worst badge should show "Día único"');
    });

    await runProbe('2.3 Days with empty meals array (meals: []) are strictly excluded from candidates', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');

        const d0 = getIsoDate(0);
        const d1 = getIsoDate(1);
        const d2 = getIsoDate(2);

        // d0 has meals: [], d1 has meal_count: 0, d2 has 1 meal
        const grouped = {
            [d0]: { cal: 0, prot: 0, carb: 0, grasas: 0, meals: [] },
            [d1]: { cal: 500, prot: 30, carb: 50, grasas: 10, meal_count: 0 },
            [d2]: { cal: 2000, prot: 180, carb: 200, grasas: 70, meals: [createMeal({ cal: 2000, prot: 180 })] }
        };

        const res = calcBestWorst(grouped, 7);
        assert.strictEqual(res.totalLoggedDays, 1, 'Only d2 should be counted as logged day');
        assert.strictEqual(res.best.date, d2);
        assert.strictEqual(res.worst, null);
    });

    // ==================================================================
    // SUITE 3: FEATURE R3 - 1000-TRIAL RANDOMIZED PROPERTY-BASED FUZZING
    // ==================================================================
    console.log('\n▶ [Suite 3] R3: 1000-Trial Property-Based Fuzzing & Invariant Verification');
    console.log('─'.repeat(70));

    await runProbe('3.1 1000 random distributions maintain all mathematical invariants', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');

        const goals = { cal: 2300, prot: 185, carb: 220, grasas: 75 };
        let trialsWith2Plus = 0;
        let trialsWith1 = 0;
        let trialsWith0 = 0;

        for (let trial = 0; trial < 1000; trial++) {
            const range = [7, 14, 30][trial % 3];
            const grouped = {};
            let loggedCount = 0;

            for (let i = 0; i < range; i++) {
                const dt = getIsoDate(i);
                // 40% probability of being an unlogged day
                if (Math.random() > 0.4) {
                    const mealCount = Math.floor(Math.random() * 5) + 1;
                    const cal = Math.floor(Math.random() * 4000);
                    const prot = Math.floor(Math.random() * 300);
                    const carb = Math.floor(Math.random() * 400);
                    const grasas = Math.floor(Math.random() * 150);
                    const meals = Array.from({ length: mealCount }, (_, m) => createMeal({ cal: Math.floor(cal / mealCount) }));

                    grouped[dt] = { cal, prot, carb, grasas, meals };
                    loggedCount++;
                }
            }

            const res = calcBestWorst(grouped, range, goals);

            // Invariant 1: totalLoggedDays matches count of days with meals.length > 0
            assert.strictEqual(res.totalLoggedDays, loggedCount, `Trial ${trial}: totalLoggedDays mismatch`);

            // Invariant 2: Structure matches totalLoggedDays
            if (loggedCount === 0) {
                trialsWith0++;
                assert.strictEqual(res.best, null, `Trial ${trial}: best must be null for 0 logged days`);
                assert.strictEqual(res.worst, null, `Trial ${trial}: worst must be null for 0 logged days`);
                assert.strictEqual(res.hasEnoughDays, false);
            } else if (loggedCount === 1) {
                trialsWith1++;
                assert(res.best !== null, `Trial ${trial}: best must not be null for 1 logged day`);
                assert.strictEqual(res.worst, null, `Trial ${trial}: worst must be null for 1 logged day`);
                assert.strictEqual(res.hasEnoughDays, false);
            } else {
                trialsWith2Plus++;
                assert(res.best !== null, `Trial ${trial}: best must not be null`);
                assert(res.worst !== null, `Trial ${trial}: worst must not be null`);
                assert.strictEqual(res.hasEnoughDays, true);

                // Invariant 3: Best score >= Worst score
                assert(res.best.score >= res.worst.score, `Trial ${trial}: best score (${res.best.score}) < worst score (${res.worst.score})`);

                // Invariant 4: Best date != Worst date
                assert.notStrictEqual(res.best.date, res.worst.date, `Trial ${trial}: best date equals worst date`);

                // Invariant 5: Best and worst dates exist in grouped and have > 0 meals
                assert(grouped[res.best.date]?.meals?.length > 0, `Trial ${trial}: best day has 0 meals`);
                assert(grouped[res.worst.date]?.meals?.length > 0, `Trial ${trial}: worst day has 0 meals`);
            }
        }
        console.log(`     (Tested 1000 configurations: ${trialsWith2Plus} multi-day, ${trialsWith1} single-day, ${trialsWith0} zero-meal)`);
    });

    // ==================================================================
    // SUITE 4: FEATURE R4 - CHART MISSING DAYS (ALL-MISSING 7/14/30d)
    // ==================================================================
    console.log('\n▶ [Suite 4] R4: All-Missing Periods (7d, 14d, 30d) in Trend Charts');
    console.log('─'.repeat(70));

    for (const range of [7, 14, 30]) {
        await runProbe(`4.${range === 7 ? 1 : range === 14 ? 2 : 3} All ${range} days missing: gray stubs, warning labels, moving average null`, async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            env.eval(`currentRange = ${range};`);
            const renderCharts = env.getGlobal('renderCharts');
            assert(typeof renderCharts === 'function', 'renderCharts must be defined');

            // Render with empty grouped object
            renderCharts({});

            const chartKeys = ['chartCal', 'chartProt', 'chartCarb', 'chartGrasas'];
            const charts = env.getGlobal('charts');

            for (const key of chartKeys) {
                const chart = charts[key];
                assert(chart, `Chart ${key} must exist`);
                const labels = chart.data.labels;
                const barDs = chart.data.datasets[0];
                const lineDs = chart.data.datasets[1];

                assert.strictEqual(labels.length, range, `${key} labels length must be ${range}`);
                assert.strictEqual(barDs.data.length, range, `${key} bar data length must be ${range}`);
                assert.strictEqual(barDs.backgroundColor.length, range, `${key} bgColors length must be ${range}`);
                assert.strictEqual(lineDs.data.length, range, `${key} line data length must be ${range}`);

                // Check minBarLength
                assert.strictEqual(barDs.minBarLength, 10, `${key} minBarLength must be 10`);

                // Check that every day has ⚠️ in label
                labels.forEach((lbl, idx) => {
                    assert(String(lbl).includes('⚠️'), `Day ${idx} label "${lbl}" must contain ⚠️`);
                });

                // Check that every day has slate/gray background color
                barDs.backgroundColor.forEach((color, idx) => {
                    assert(color.includes('100, 116, 139') || color.includes('slate') || color.includes('gray'), 
                        `Day ${idx} color "${color}" must be gray/slate`);
                });

                // Check that moving average is null (not 0, not NaN) for all days
                lineDs.data.forEach((val, idx) => {
                    assert.strictEqual(val, null, `Day ${idx} moving average must be null when all days are missing, got: ${val}`);
                });

                // Check tooltip label callback via chart.tooltipCallbacks
                const tooltipCb = chart.tooltipCallbacks?.label;
                assert(typeof tooltipCb === 'function', 'Tooltip label callback must be a function');
                for (let idx = 0; idx < range; idx++) {
                    const ctx = { dataIndex: idx, datasetIndex: 0, chart };
                    const tip = tooltipCb(ctx);
                    assert(String(tip).includes('⚠️') && String(tip).includes('Sin comidas registradas'), 
                        `Tooltip for day ${idx} must return warning, got: "${tip}"`);
                }
            }
        });
    }

    // ==================================================================
    // SUITE 5: FEATURE R4 - SPARSE & ALTERNATING MISSING DAYS
    // ==================================================================
    console.log('\n▶ [Suite 5] R4: Sparse & Alternating Missing Days & Moving Average Protection');
    console.log('─'.repeat(70));

    await runProbe('5.1 Alternating days (Day 0 logged, Day 1 missing, Day 2 logged...) maintains active moving average without plummeting to 0', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        env.eval(`currentRange = 7;`);
        const renderCharts = env.getGlobal('renderCharts');

        // Oldest is day 6, newest is day 0
        // We log days 0, 2, 4, 6 (4 logged days). Days 1, 3, 5 are missing (3 missing days).
        const grouped = {};
        for (let i = 0; i < 7; i++) {
            const dt = getIsoDate(i);
            if (i % 2 === 0) {
                grouped[dt] = { cal: 2000 + i * 100, prot: 180, carb: 220, grasas: 70, meals: [createMeal({ cal: 2000 + i * 100 })] };
            }
        }

        renderCharts(grouped);
        const charts = env.getGlobal('charts');
        const calChart = charts['chartCal'];
        const barDs = calChart.data.datasets[0];
        const lineDs = calChart.data.datasets[1];
        const labels = calChart.data.labels;

        // In renderCharts, allDays is built from i = currentRange - 1 down to 0:
        // index 0 in chart = day 6 ago (logged)
        // index 1 in chart = day 5 ago (missing)
        // index 2 in chart = day 4 ago (logged)
        // index 3 in chart = day 3 ago (missing)
        // index 4 in chart = day 2 ago (logged)
        // index 5 in chart = day 1 ago (missing)
        // index 6 in chart = day 0 ago (logged)
        const expectedMissing = [false, true, false, true, false, true, false];

        expectedMissing.forEach((isMiss, idx) => {
            const lbl = labels[idx];
            const color = barDs.backgroundColor[idx];
            if (isMiss) {
                assert(lbl.includes('⚠️'), `Chart index ${idx} must have ⚠️ in label`);
                assert(color.includes('100, 116, 139'), `Chart index ${idx} must have gray color`);
            } else {
                assert(!lbl.includes('⚠️'), `Chart index ${idx} should not have ⚠️ in label`);
            }

            // CRITICAL INVARIANT: Moving average must NEVER be 0!
            const ma = lineDs.data[idx];
            assert(typeof ma === 'number' && ma > 0, `Moving average at index ${idx} must be > 0, got: ${ma}`);
        });

        // Verify index 1 (day 5 ago, missing):
        // Trailing window is [idx 0, idx 1]. Idx 0 is logged with 2600. Idx 1 is missing.
        // Active values = [2600]. Moving average = 2600!
        assert.strictEqual(lineDs.data[1], 2600, `Index 1 moving average should be 2600, got ${lineDs.data[1]}`);
    });

    await runProbe('5.2 Isolated single logged day in 30-day range preserves trailing MA then transitions to null cleanly', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        env.eval(`currentRange = 30;`);
        const renderCharts = env.getGlobal('renderCharts');

        // Only 1 day logged: day 20 ago (index 9 in a 30-day chart from 29 down to 0)
        // Indices 0..8: days 29..21 ago (all missing)
        // Index 9: day 20 ago (logged with 2100 cal)
        // Indices 10..15: days 19..14 ago (missing, but within trailing 7-day window of index 9)
        // Indices 16..29: days 13..0 ago (missing, index 9 drops out of 7-day trailing window)
        const dt20 = getIsoDate(20);
        const grouped = {
            [dt20]: { cal: 2100, prot: 180, carb: 200, grasas: 70, meals: [createMeal({ cal: 2100 })] }
        };

        renderCharts(grouped);
        const calChart = env.getGlobal('charts')['chartCal'];
        const lineDs = calChart.data.datasets[1];

        // Indices 0..8 must be null (no logged days yet)
        for (let i = 0; i < 9; i++) {
            assert.strictEqual(lineDs.data[i], null, `Index ${i} before logged day must be null, got: ${lineDs.data[i]}`);
        }

        // Index 9 must be 2100
        assert.strictEqual(lineDs.data[9], 2100, `Index 9 must be 2100, got: ${lineDs.data[9]}`);

        // Indices 10..15 must be 2100 (active value preserved in trailing 7-day window)
        for (let i = 10; i <= 15; i++) {
            assert.strictEqual(lineDs.data[i], 2100, `Index ${i} in trailing window must be 2100, got: ${lineDs.data[i]}`);
        }

        // Indices 16..29 must transition back to null (not 0!)
        for (let i = 16; i < 30; i++) {
            assert.strictEqual(lineDs.data[i], null, `Index ${i} after window expires must be null, got: ${lineDs.data[i]}`);
        }

        // Zero check: No element in lineDs.data is 0!
        const zeros = lineDs.data.filter(v => v === 0);
        assert.strictEqual(zeros.length, 0, 'Moving average dataset must contain 0 zeros');
    });

    // ==================================================================
    // SUITE 6: FEATURE R4 - TODAY MISSING BOUNDARY CASE
    // ==================================================================
    console.log('\n▶ [Suite 6] R4: Today Missing Boundary Case');
    console.log('─'.repeat(70));

    await runProbe('6.1 Today (index N-1) unlogged: displays as missing bar without disrupting trailing moving average', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        env.eval(`currentRange = 7;`);
        const renderCharts = env.getGlobal('renderCharts');

        // Past 6 days logged (days 6..1 ago), Today (day 0) unlogged
        const grouped = {};
        for (let i = 1; i <= 6; i++) {
            const dt = getIsoDate(i);
            grouped[dt] = { cal: 2000, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2000 })] };
        }

        renderCharts(grouped);
        const calChart = env.getGlobal('charts')['chartCal'];
        const barDs = calChart.data.datasets[0];
        const lineDs = calChart.data.datasets[1];
        const labels = calChart.data.labels;

        const todayIdx = 6; // index 6 is getLogicalDateAgo(0) = today
        assert(labels[todayIdx].includes('⚠️'), 'Today label must include ⚠️');
        assert(barDs.backgroundColor[todayIdx].includes('100, 116, 139'), 'Today bar must have gray background');
        assert.strictEqual(barDs.data[todayIdx], 0, 'Today data must be 0');
        assert.strictEqual(barDs.minBarLength, 10, 'minBarLength must be 10');

        // Today's moving average must reflect the trailing 6 logged days (2000 kcal), NOT plummet to 0!
        assert.strictEqual(lineDs.data[todayIdx], 2000, `Today's moving average must be 2000, got: ${lineDs.data[todayIdx]}`);
    });

    // ==================================================================
    // SUITE 7: FEATURE R4 - TOOLTIP & COLOR DISCRIMINATION
    // ==================================================================
    console.log('\n▶ [Suite 7] R4: Tooltip & Color Discrimination (Over-Goal vs Missing)');
    console.log('─'.repeat(70));

    await runProbe('7.1 Over-goal days are colored red (rgba(239, 68, 68, 0.6)) while missing days are slate-gray (rgba(100, 116, 139, 0.25))', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        env.eval(`currentRange = 7;`);
        const renderCharts = env.getGlobal('renderCharts');

        const dNormal = getIsoDate(2);
        const dOver = getIsoDate(1);
        const dMissing = getIsoDate(0);

        const grouped = {
            [dNormal]: { cal: 2000, prot: 180, carb: 200, grasas: 70, meals: [createMeal({ cal: 2000 })] },
            [dOver]: { cal: 3500, prot: 250, carb: 400, grasas: 120, meals: [createMeal({ cal: 3500 })] } // > 2300 goal
            // dMissing is omitted -> 0 meals
        };

        renderCharts(grouped);
        const calChart = env.getGlobal('charts')['chartCal'];
        const barDs = calChart.data.datasets[0];

        // In 7-day chart:
        // index 4 = dNormal (day 2 ago)
        // index 5 = dOver (day 1 ago)
        // index 6 = dMissing (day 0 ago)
        const cNormal = barDs.backgroundColor[4];
        const cOver = barDs.backgroundColor[5];
        const cMissing = barDs.backgroundColor[6];

        assert(!cNormal.includes('239, 68, 68') && !cNormal.includes('100, 116, 139'), `Normal bar color should be default bar color, got ${cNormal}`);
        assert(cOver.includes('239, 68, 68'), `Over-goal bar must be red, got: ${cOver}`);
        assert(cMissing.includes('100, 116, 139'), `Missing bar must be slate-gray, got: ${cMissing}`);
    });

    await runProbe('7.2 Missing day with goal 0 is NOT misidentified as over-goal', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const makeChart = env.getGlobal('makeChart');

        // Test makeChart directly with goalValue = 0 and missingFlags = [true, false]
        makeChart('chartCal', ['⚠️ Day 1', 'Day 2'], [0, 100], 0, '#3b82f6', 'Meta', [true, false]);

        const chart = env.getGlobal('charts')['chartCal'];
        const bgColors = chart.data.datasets[0].backgroundColor;

        assert(bgColors[0].includes('100, 116, 139'), `Missing day must remain gray even when goalValue is 0, got ${bgColors[0]}`);
        assert(bgColors[1].includes('239, 68, 68'), `Logged day with 100 > 0 must be red, got ${bgColors[1]}`);
    });

    // ==================================================================
    // SUITE 8: DOM CONSISTENCY & REPEATED RE-RENDERING STABILITY
    // ==================================================================
    console.log('\n▶ [Suite 8] DOM Consistency & 50x Re-rendering Stress Test');
    console.log('─'.repeat(70));

    await runProbe('8.1 50x repeated loadAll / renderBestWorstDays / renderCharts causes zero duplicate elements or leaks', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const doc = env.document;

        const d0 = getIsoDate(0);
        const d1 = getIsoDate(1);
        const grouped = {
            [d0]: { cal: 2200, prot: 180, carb: 210, grasas: 70, meals: [createMeal({ cal: 2200 })] },
            [d1]: { cal: 2500, prot: 190, carb: 230, grasas: 80, meals: [createMeal({ cal: 2500 })] }
        };

        const renderBestWorst = env.getGlobal('renderBestWorstDays');
        const renderCharts = env.getGlobal('renderCharts');

        // Execute 50 cycles
        for (let cycle = 0; cycle < 50; cycle++) {
            renderBestWorst(grouped);
            renderCharts(grouped);
        }

        // Verify element counts
        const bestCards = doc.querySelectorAll('#best-day-card');
        const worstCards = doc.querySelectorAll('#worst-day-card');
        const bestDates = doc.querySelectorAll('#best-day-date');
        const worstDates = doc.querySelectorAll('#worst-day-date');

        assert.strictEqual(bestCards.length, 1, 'Exactly 1 #best-day-card must exist');
        assert.strictEqual(worstCards.length, 1, 'Exactly 1 #worst-day-card must exist');
        assert.strictEqual(bestDates.length, 1, 'Exactly 1 #best-day-date must exist');
        assert.strictEqual(worstDates.length, 1, 'Exactly 1 #worst-day-date must exist');

        // Verify chart canvas elements
        const canvases = ['chartCal', 'chartProt', 'chartCarb', 'chartGrasas'];
        for (const cid of canvases) {
            const els = doc.querySelectorAll(`#${cid}`);
            assert.strictEqual(els.length, 1, `Exactly 1 canvas for #${cid} must exist`);
        }

        // Verify DOM content is valid
        const bestDateText = doc.getElementById('best-day-date').textContent;
        const worstDateText = doc.getElementById('worst-day-date').textContent;
        assert(bestDateText !== '' && bestDateText !== '—', `Best date text must be valid: "${bestDateText}"`);
        assert(worstDateText !== '' && worstDateText !== '—', `Worst date text must be valid: "${worstDateText}"`);
    });

    // ==================================================================
    // SUITE 9: ADVANCED ADVERSARIAL EDGE VECTORS (LEAKAGE, FASTING, RANGE)
    // ==================================================================
    console.log('\n▶ [Suite 9] Advanced Adversarial Vectors (Leakage, Zero Goals, Fasting, Dynamic Range)');
    console.log('─'.repeat(70));

    await runProbe('9.1 Date range isolation: Perfect day 10 days ago is NOT selected when currentRange is 7d', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');

        const dOlder = getIsoDate(10); // 10 days ago (outside 7d window)
        const dRecent = getIsoDate(2); // 2 days ago (inside 7d window)

        const grouped = {
            // Older day has perfect 10/10 macros
            [dOlder]: { cal: 2300, prot: 185, carb: 220, grasas: 75, meals: [createMeal({ cal: 2300, prot: 185 })] },
            // Recent day has suboptimal macros
            [dRecent]: { cal: 1500, prot: 100, carb: 150, grasas: 50, meals: [createMeal({ cal: 1500, prot: 100 })] }
        };

        const res = calcBestWorst(grouped, 7);
        assert.strictEqual(res.totalLoggedDays, 1, 'Only 1 day within 7d range should be counted');
        assert.strictEqual(res.best.date, dRecent, 'Best day must be dRecent within the active range');
        assert.notStrictEqual(res.best.date, dOlder, 'dOlder outside range must be strictly excluded');
    });

    await runProbe('9.2 Zero goals fallback: Goals with all zeros do not cause NaN or division by zero', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');
        const d0 = getIsoDate(0);
        const d1 = getIsoDate(1);

        const grouped = {
            [d0]: { cal: 2000, prot: 150, carb: 200, grasas: 70, meals: [createMeal({ cal: 2000 })] },
            [d1]: { cal: 2200, prot: 160, carb: 210, grasas: 75, meals: [createMeal({ cal: 2200 })] }
        };

        const zeroGoals = { cal: 0, prot: 0, carb: 0, grasas: 0 };
        const res = calcBestWorst(grouped, 7, zeroGoals);

        assert(res.best && res.worst, 'Must calculate without crashing');
        assert(!isNaN(res.best.score) && isFinite(res.best.score), 'Best score must be finite number');
        assert(!isNaN(res.worst.score) && isFinite(res.worst.score), 'Worst score must be finite number');
        assert(!isNaN(res.best.protRatio) && isFinite(res.best.protRatio), 'Protein ratio must be finite');
    });

    await runProbe('9.3 Null and undefined resilience: Handlers survive null data safely', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');
        const renderBestWorst = env.getGlobal('renderBestWorstDays');
        const renderCharts = env.getGlobal('renderCharts');

        // Should not throw on null / undefined
        assert.doesNotThrow(() => calcBestWorst(null, 7));
        assert.doesNotThrow(() => calcBestWorst(undefined, 7));
        assert.doesNotThrow(() => renderBestWorst(null));
        assert.doesNotThrow(() => renderBestWorst(undefined));
        assert.doesNotThrow(() => renderCharts({}));
    });

    await runProbe('9.4 Fasting day (logged meal with 0 cal, 0 prot) is treated as LOGGED (not missing ⚠️)', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        env.eval(`currentRange = 7;`);
        const renderCharts = env.getGlobal('renderCharts');
        const calcBestWorst = env.getGlobal('calculateBestWorstDays');

        const dFasting = getIsoDate(0);
        const dNormal = getIsoDate(1);

        // Fasting log: logged explicit meal with 0 macros
        const grouped = {
            [dFasting]: { cal: 0, prot: 0, carb: 0, grasas: 0, meals: [{ comida: 'Fasting / Ayuno', calorias: 0, proteina_g: 0, carbohidratos_g: 0, grasas_g: 0 }] },
            [dNormal]: { cal: 2000, prot: 180, carb: 200, grasas: 70, meals: [createMeal({ cal: 2000 })] }
        };

        // R3: Fasting day should be counted in candidates
        const res = calcBestWorst(grouped, 7);
        assert.strictEqual(res.totalLoggedDays, 2, 'Fasting day with meals > 0 must be counted as logged day');
        assert.strictEqual(res.worst.date, dFasting, 'Fasting day with 0 macros is the worst day');

        // R4: Fasting day chart bar should NOT have ⚠️
        renderCharts(grouped);
        const calChart = env.getGlobal('charts')['chartCal'];
        const labels = calChart.data.labels;
        const barDs = calChart.data.datasets[0];

        const fastingIdx = 6; // today
        assert(!labels[fastingIdx].includes('⚠️'), `Fasting day label "${labels[fastingIdx]}" should NOT contain ⚠️ because it has a logged meal`);
    });

    await runProbe('9.5 Multi-range switching sequence (7d -> 30d -> 14d -> 7d) maintains chart integrity and correct lengths', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();
        const renderCharts = env.getGlobal('renderCharts');

        const grouped = {};
        for (let i = 0; i < 30; i++) {
            if (i % 3 !== 0) { // some missing, some logged
                const dt = getIsoDate(i);
                grouped[dt] = { cal: 2100, prot: 180, carb: 200, grasas: 70, meals: [createMeal({ cal: 2100 })] };
            }
        }

        const ranges = [7, 30, 14, 7];
        for (const r of ranges) {
            env.eval(`currentRange = ${r};`);
            renderCharts(grouped);
            const calChart = env.getGlobal('charts')['chartCal'];
            assert.strictEqual(calChart.data.labels.length, r, `Chart labels length must be ${r}`);
            assert.strictEqual(calChart.data.datasets[0].data.length, r, `Bar dataset length must be ${r}`);
            assert.strictEqual(calChart.data.datasets[1].data.length, r, `MA dataset length must be ${r}`);
            assert.strictEqual(calChart.data.datasets[0].minBarLength, 10, 'minBarLength must stay 10');
        }
    });

    console.log('\n======================================================================');
    console.log('                 STRESS TEST EXECUTION SUMMARY');
    console.log('======================================================================');
    console.log(` Total Probes Executed : ${passCount + failCount}`);
    console.log(` Passed                : ${passCount}`);
    console.log(` Failed                : ${failCount}`);
    console.log('======================================================================\n');

    if (failCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runAllStressTests().catch(err => {
    console.error('Fatal stress harness failure:', err);
    process.exit(1);
});
