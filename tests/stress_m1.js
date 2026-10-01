/**
 * Milestone M1 Empirical Stress Harness
 * 
 * Stress-tests:
 * 1. Rapid user switching (Nacho <-> Mamá) under variable async latency and out-of-order resolution.
 * 2. Rapid range switching (7d <-> 14d <-> 30d) under async latency.
 * 3. renderAverages date range isolation and leak defense (expanded buffer vs current window).
 * 4. Auto-refresh DOM stability (50x loadAll execution, listener leak check, card duplication, day navigation preservation).
 * 5. Error & fallback resilience (empty metas, network failure, zero meals).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { createMeal, getLogicalDateString, createNachoTwoPeriodSet } = require('./fixtures/comidas_fixtures');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Stats tracking
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    process.stdout.write(`  ▶ ${name} ... `);
    try {
        await fn();
        console.log(`\x1b[32mPASS\x1b[0m`);
        passed++;
    } catch (err) {
        console.log(`\x1b[31mFAIL\x1b[0m`);
        console.error(`    Error: ${err.message}`);
        failures.push({ name, error: err });
        failed++;
    }
}

async function runAllStressTests() {
    console.log(`\n======================================================================`);
    console.log(`       NutriNacho M1 Empirical Stress Suite: State & DOM Stability     `);
    console.log(`======================================================================\n`);

    // ------------------------------------------------------------------
    // SUITE 1: Rapid User Switching (Nacho <-> Mamá)
    // ------------------------------------------------------------------
    console.log(`--- SUITE 1: Rapid User Switching & Race Conditions ---`);

    await test('1.1 Out-of-order async resolution: Mamá request slow (80ms), Nacho request fast (20ms)', async () => {
        // Prepare environment with distinct goals and meals for Nacho and Mamá
        const nachoGoals = { ...METAS_FIXTURES.nachoActive, calorias: 2450, proteina_g: 195 };
        const mamaGoals = { ...METAS_FIXTURES.mamaActive, calorias: 1720, proteina_g: 135 };

        const nachoMeals = [
            createMeal({ usuario_id: NACHO_ID, dayOffset: 0, comida: 'Nacho Bife', calorias: 900, proteina_g: 70 })
        ];
        const mamaMeals = [
            createMeal({ usuario_id: MAMA_ID, dayOffset: 0, comida: 'Mamá Ensalada', calorias: 400, proteina_g: 30 })
        ];

        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                metas: [nachoGoals, mamaGoals],
                comidas: [...nachoMeals, ...mamaMeals]
            }
        });
        env.runScript();
        await env.sandbox.loadAll();

        // Initially Nacho
        assert.strictEqual(env.sandbox.currentUser, NACHO_ID);
        assert.strictEqual(Number(env.document.getElementById('cal-meta').textContent), 2450);

        // Configure latency simulation in supabase mock
        const originalFrom = env.sandbox.sb.from;
        env.sandbox.sb.from = function(table) {
            const builder = originalFrom.call(env.sandbox.sb, table);
            const origExecute = builder._execute.bind(builder);
            builder._execute = async function() {
                // If query is for Mamá, inject 80ms latency. If Nacho, inject 15ms latency.
                const isMama = this.filters.some(f => f.column === 'usuario_id' && f.value == MAMA_ID);
                const delay = isMama ? 80 : 15;
                await sleep(delay);
                return origExecute();
            };
            return builder;
        };

        // User rapidly toggles: Nacho -> Mamá -> Nacho
        env.sandbox.selectUser(MAMA_ID); // Trigger Mamá (will take ~160ms total for 2 queries)
        await sleep(10); // Wait 10ms
        env.sandbox.selectUser(NACHO_ID); // Trigger Nacho (will take ~30ms total and finish FIRST)

        // Wait for all in-flight promises to complete
        await sleep(200);

        // Verify final state matches Nacho, NOT Mamá
        assert.strictEqual(env.sandbox.currentUser, NACHO_ID, 'currentUser should be Nacho');
        const calMeta = env.document.getElementById('cal-meta').textContent;
        const protMeta = env.document.getElementById('prot-meta').textContent;
        assert.strictEqual(Number(calMeta), 2450, `Expected Nacho cal-meta 2450, got ${calMeta}`);
        assert.strictEqual(Number(protMeta), 195, `Expected Nacho prot-meta 195, got ${protMeta}`);

        // Verify active pills
        assert(env.document.getElementById(`user-${NACHO_ID}`).classList.contains('active'), 'Nacho pill should be active');
        assert(!env.document.getElementById(`user-${MAMA_ID}`).classList.contains('active'), 'Mamá pill should NOT be active');

        // Verify meals body shows Nacho's meal, not Mamá's
        const tbodyText = env.document.getElementById('meals-body').textContent;
        assert(tbodyText.includes('Nacho Bife'), `Meals table should contain Nacho Bife, got: ${tbodyText}`);
        assert(!tbodyText.includes('Mamá Ensalada'), `Meals table should NOT contain Mamá Ensalada`);
    });

    await test('1.2 High-frequency oscillation (50 rapid switches) leaves coherent final state', async () => {
        const nachoGoals = { ...METAS_FIXTURES.nachoActive, calorias: 2450, proteina_g: 195 };
        const mamaGoals = { ...METAS_FIXTURES.mamaActive, calorias: 1720, proteina_g: 135 };

        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                metas: [nachoGoals, mamaGoals],
                comidas: [
                    createMeal({ usuario_id: NACHO_ID, dayOffset: 0, comida: 'Nacho Shake', calorias: 500, proteina_g: 50 }),
                    createMeal({ usuario_id: MAMA_ID, dayOffset: 0, comida: 'Mamá Té', calorias: 100, proteina_g: 5 })
                ]
            }
        });
        env.runScript();
        await env.sandbox.loadAll();

        // Add random jitter latency (1-15ms)
        const originalFrom = env.sandbox.sb.from;
        env.sandbox.sb.from = function(table) {
            const builder = originalFrom.call(env.sandbox.sb, table);
            const origExecute = builder._execute.bind(builder);
            builder._execute = async function() {
                const jitter = Math.floor(Math.random() * 15) + 1;
                await sleep(jitter);
                return origExecute();
            };
            return builder;
        };

        let targetUser = NACHO_ID;
        for (let i = 0; i < 50; i++) {
            targetUser = (i % 2 === 0) ? MAMA_ID : NACHO_ID;
            env.sandbox.selectUser(targetUser);
            await sleep(2); // very fast 2ms interval
        }

        // Wait for all operations to settle
        await sleep(350);

        assert.strictEqual(env.sandbox.currentUser, targetUser, `Final currentUser should be ${targetUser}`);
        const expectedCal = (targetUser === NACHO_ID) ? 2450 : 1720;
        const actualCal = Number(env.document.getElementById('cal-meta').textContent);
        assert.strictEqual(actualCal, expectedCal, `cal-meta mismatch after 50 switches: expected ${expectedCal}, got ${actualCal}`);
    });

    await test('1.3 Switching to user with 0 meals today displays neutral Daily Score (—/10)', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                comidas: [
                    // Nacho has a meal today
                    createMeal({ usuario_id: NACHO_ID, dayOffset: 0, comida: 'Nacho Cena', calorias: 800, proteina_g: 60 }),
                    // Mamá has NO meals today (only 3 days ago)
                    createMeal({ usuario_id: MAMA_ID, dayOffset: -3, comida: 'Mamá Pasado', calorias: 600, proteina_g: 40 })
                ]
            }
        });
        env.runScript();
        await env.sandbox.loadAll();

        // Nacho score is active (numeric)
        const nachoScore = env.document.getElementById('daily-score-val').textContent;
        assert(nachoScore !== '—', `Nacho should have numeric score, got: ${nachoScore}`);

        // Switch to Mamá
        env.sandbox.selectUser(MAMA_ID);
        await sleep(50);

        const mamaScore = env.document.getElementById('daily-score-val').textContent;
        const mamaBadge = env.document.getElementById('daily-score-badge').textContent;
        assert.strictEqual(mamaScore, '—', `Mamá (0 meals today) should display '—', got: ${mamaScore}`);
        assert.strictEqual(mamaBadge, 'Sin registros hoy', `Mamá badge should be 'Sin registros hoy', got: ${mamaBadge}`);
    });

    // ------------------------------------------------------------------
    // SUITE 2: Rapid Range Switching (7d <-> 14d <-> 30d)
    // ------------------------------------------------------------------
    console.log(`\n--- SUITE 2: Rapid Range Switching & Range Synchronization ---`);

    await test('2.1 Rapid range changes: 7d -> 30d -> 14d -> 7d with slower historical queries', async () => {
        // Meals crafted so 7d, 14d, 30d produce distinct averages
        const meals = [];
        // Offsets 0 to -6 (7d): 2100 cal
        for (let i = 0; i >= -6; i--) {
            meals.push(createMeal({ dayOffset: i, calorias: 2100, proteina_g: 170 }));
        }
        // Offsets -7 to -13: 1500 cal
        for (let i = -7; i >= -13; i--) {
            meals.push(createMeal({ dayOffset: i, calorias: 1500, proteina_g: 120 }));
        }
        // Offsets -14 to -29: 1000 cal
        for (let i = -14; i >= -29; i--) {
            meals.push(createMeal({ dayOffset: i, calorias: 1000, proteina_g: 80 }));
        }

        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                comidas: meals
            }
        });
        env.runScript();
        await env.sandbox.loadAll();

        // Inject latency: bigger buffer queries take much longer
        const originalFrom = env.sandbox.sb.from;
        env.sandbox.sb.from = function(table) {
            const builder = originalFrom.call(env.sandbox.sb, table);
            const origExecute = builder._execute.bind(builder);
            builder._execute = async function() {
                // If querying for >40 days, simulate 70ms latency; else 10ms
                const gteFilter = this.filters.find(f => f.column === 'fecha');
                const delay = (table === 'comidas' && env.sandbox.currentRange === 30) ? 70 : 10;
                await sleep(delay);
                return origExecute();
            };
            return builder;
        };

        // Switch sequence: 30d -> 14d -> 7d in rapid succession
        env.sandbox.setRange(30);
        await sleep(5);
        env.sandbox.setRange(14);
        await sleep(5);
        env.sandbox.setRange(7);

        // Wait for all to settle
        await sleep(150);

        assert.strictEqual(env.sandbox.currentRange, 7, 'currentRange should be 7');
        assert(env.document.getElementById('range-7').classList.contains('active'), 'range-7 button should be active');
        assert(!env.document.getElementById('range-30').classList.contains('active'), 'range-30 button should NOT be active');

        // Verify average is exactly 2100 kcal (7d average), not corrupted by 30d query
        const avgCal = env.document.getElementById('avg-cal').textContent;
        assert(avgCal.includes('2100'), `Expected 7d average 2100 kcal, got: ${avgCal}`);
    });

    await test('2.2 Range switching updates period comparison deltas immediately', async () => {
        // 7d: Curr = 2100, Prev = 1500 -> ((2100-1500)/1500)*100 = +40%
        // 14d: Curr 14d (0 to -13) = (7*2100 + 7*1500)/14 = 1800. Prev 14d (-14 to -27) = 1000.
        // Delta 14d = ((1800-1000)/1000)*100 = +80%
        const meals = [];
        for (let i = 0; i >= -6; i--) meals.push(createMeal({ dayOffset: i, calorias: 2100, proteina_g: 170 }));
        for (let i = -7; i >= -13; i--) meals.push(createMeal({ dayOffset: i, calorias: 1500, proteina_g: 120 }));
        for (let i = -14; i >= -27; i--) meals.push(createMeal({ dayOffset: i, calorias: 1000, proteina_g: 80 }));

        const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
        env.runScript();
        await env.sandbox.loadAll();

        // Check 7d delta
        const deltaNode7 = env.document.getElementById('delta-cal') || env.document.getElementById('avg-cal-delta');
        assert(deltaNode7.textContent.includes('40%'), `Expected +40% delta for 7d, got: "${deltaNode7.textContent}"`);

        // Switch to 14d
        env.sandbox.setRange(14);
        await sleep(30);

        const deltaNode14 = env.document.getElementById('delta-cal') || env.document.getElementById('avg-cal-delta');
        assert(deltaNode14.textContent.includes('80%'), `Expected +80% delta for 14d, got: "${deltaNode14.textContent}"`);
    });

    // ------------------------------------------------------------------
    // SUITE 3: renderAverages Date Range Isolation & Leak Defense
    // ------------------------------------------------------------------
    console.log(`\n--- SUITE 3: renderAverages Date Range Isolation & Leak Defense ---`);

    await test('3.1 Buffer poison defense: Days 14–21 (expanded buffer) do NOT leak into 7d averages', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();

        // Synthetic grouped object spanning 25 days:
        // Current 7d (0 to -6): 2000 cal / day
        // Previous 7d (-7 to -13): 1500 cal / day
        // Buffer days (-14 to -24): 9999 cal / day (EXTREME POISON DATA!)
        const grouped = {};
        for (let i = 0; i < 25; i++) {
            const dateStr = env.sandbox.getLogicalDateAgo(i);
            if (i <= 6) {
                grouped[dateStr] = { cal: 2000, prot: 150, carb: 200, grasas: 60, meals: [{ id: i }] };
            } else if (i <= 13) {
                grouped[dateStr] = { cal: 1500, prot: 100, carb: 150, grasas: 50, meals: [{ id: i }] };
            } else {
                grouped[dateStr] = { cal: 9999, prot: 999, carb: 999, grasas: 999, meals: [{ id: i }] };
            }
        }

        env.sandbox.currentRange = 7;
        env.sandbox.renderAverages(grouped);

        const avgCal = env.document.getElementById('avg-cal').textContent;
        const avgProt = env.document.getElementById('avg-prot').textContent;

        assert(avgCal.includes('2000'), `Expected currAvg cal 2000 kcal (no leak), got: "${avgCal}"`);
        assert(avgProt.includes('150'), `Expected currAvg prot 150g (no leak), got: "${avgProt}"`);

        // Check delta: ((2000 - 1500) / 1500) * 100 = +33%
        const deltaCalNode = env.document.getElementById('delta-cal') || env.document.getElementById('avg-cal-delta');
        assert(deltaCalNode.textContent.includes('33%'), `Expected delta +33%, got: "${deltaCalNode.textContent}"`);
    });

    await test('3.2 Gap days isolation: Unlogged days in current period do not pull from historical buffer', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();

        // Only 2 days logged in current period: day 0 (2400 cal) and day 2 (2000 cal).
        // Total = 4400. Logged days = 2. Expected average = 2200 cal.
        // Days 1, 3, 4, 5, 6: NO meals.
        // Days 7 to 20: active meals with 1000 cal.
        const grouped = {};
        const d0 = env.sandbox.getLogicalDateAgo(0);
        const d2 = env.sandbox.getLogicalDateAgo(2);
        grouped[d0] = { cal: 2400, prot: 180, carb: 220, grasas: 70, meals: [{ id: 1 }] };
        grouped[d2] = { cal: 2000, prot: 160, carb: 200, grasas: 60, meals: [{ id: 2 }] };

        // Fill days 7-20
        for (let i = 7; i <= 20; i++) {
            const d = env.sandbox.getLogicalDateAgo(i);
            grouped[d] = { cal: 1000, prot: 80, carb: 100, grasas: 30, meals: [{ id: i }] };
        }

        env.sandbox.currentRange = 7;
        env.sandbox.renderAverages(grouped);

        const avgCal = env.document.getElementById('avg-cal').textContent;
        assert(avgCal.includes('2200'), `Expected average over 2 logged days = 2200 kcal, got: "${avgCal}"`);
    });

    await test('3.3 Future dates protection: Meals with future timestamps do NOT inflate averages', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();

        // 7 days logged normally (2000 cal)
        const grouped = {};
        for (let i = 0; i <= 6; i++) {
            const d = env.sandbox.getLogicalDateAgo(i);
            grouped[d] = { cal: 2000, prot: 150, carb: 200, grasas: 60, meals: [{ id: i }] };
        }

        // Add 3 FUTURE dates with massive calories
        for (let i = -1; i >= -3; i--) {
            const futureD = env.sandbox.getLogicalDateAgo(i);
            grouped[futureD] = { cal: 50000, prot: 5000, carb: 5000, grasas: 5000, meals: [{ id: 999 }] };
        }

        env.sandbox.currentRange = 7;
        env.sandbox.renderAverages(grouped);

        const avgCal = env.document.getElementById('avg-cal').textContent;
        assert(avgCal.includes('2000'), `Expected average 2000 kcal (ignoring future dates), got: "${avgCal}"`);
    });

    await test('3.4 Zero logged days in previous period: Clean division-by-zero protection (s/d)', async () => {
        const env = createNutriNachoEnvironment({ silent: true });
        env.runScript();

        // Current period has data, previous period has 0 logged days
        const grouped = {};
        for (let i = 0; i <= 6; i++) {
            const d = env.sandbox.getLogicalDateAgo(i);
            grouped[d] = { cal: 2300, prot: 185, carb: 220, grasas: 75, meals: [{ id: i }] };
        }

        env.sandbox.currentRange = 7;
        env.sandbox.renderAverages(grouped);

        const deltaNode = env.document.getElementById('delta-cal') || env.document.getElementById('avg-cal-delta');
        assert(deltaNode.textContent.includes('s/d'), `Expected 's/d vs ant.' for 0 prev days, got: "${deltaNode.textContent}"`);
        assert(!deltaNode.textContent.includes('NaN'), `Must NOT contain NaN: "${deltaNode.textContent}"`);
        assert(!deltaNode.textContent.includes('Infinity'), `Must NOT contain Infinity: "${deltaNode.textContent}"`);
    });

    // ------------------------------------------------------------------
    // SUITE 4: Auto-refresh & DOM Stability (50x loadAll Execution)
    // ------------------------------------------------------------------
    console.log(`\n--- SUITE 4: Auto-refresh & DOM Stability ---`);

    await test('4.1 Executing loadAll 50 times does NOT duplicate cards, charts, or DOM elements', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                comidas: [
                    createMeal({ dayOffset: 0, comida: 'Desayuno', calorias: 500 }),
                    createMeal({ dayOffset: 0, comida: 'Almuerzo', calorias: 800 })
                ]
            }
        });
        env.runScript();

        // Baseline element counts
        const scoreCardsBefore = env.document.querySelectorAll('#daily-score-card').length;
        const avgGridsBefore = env.document.querySelectorAll('#averages-grid').length;
        const pillsBefore = env.document.querySelectorAll('.user-pill').length;
        const rangeBtnsBefore = env.document.querySelectorAll('.range-btn').length;

        // Run 50 sequential auto-refreshes
        for (let i = 0; i < 50; i++) {
            await env.sandbox.loadAll();
        }

        // Check element counts after 50 refreshes
        const scoreCardsAfter = env.document.querySelectorAll('#daily-score-card').length;
        const avgGridsAfter = env.document.querySelectorAll('#averages-grid').length;
        const pillsAfter = env.document.querySelectorAll('.user-pill').length;
        const rangeBtnsAfter = env.document.querySelectorAll('.range-btn').length;

        assert.strictEqual(scoreCardsAfter, scoreCardsBefore, 'daily-score-card must not duplicate');
        assert.strictEqual(avgGridsAfter, avgGridsBefore, 'averages-grid must not duplicate');
        assert.strictEqual(pillsAfter, pillsBefore, 'user-pill elements must not duplicate');
        assert.strictEqual(rangeBtnsAfter, rangeBtnsBefore, 'range-btn elements must not duplicate');

        // Check meal rows in table (should be exactly 2 rows, not 50*2 = 100 rows!)
        const tbodyRows = env.document.querySelectorAll('#meals-body tr');
        assert.strictEqual(tbodyRows.length, 2, `meals-body should have exactly 2 rows, got: ${tbodyRows.length}`);
    });

    await test('4.2 Auto-refresh preserves user mealDayOffset navigation state', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                comidas: [
                    createMeal({ dayOffset: 0, comida: 'Comida Hoy', calorias: 600 }),
                    createMeal({ dayOffset: -2, comida: 'Comida Pasado', calorias: 750 })
                ]
            }
        });
        env.runScript();
        await env.sandbox.loadAll();

        // User navigates back 2 days
        env.sandbox.shiftMealDay(-1);
        env.sandbox.shiftMealDay(-1);
        assert.strictEqual(env.sandbox.mealDayOffset, -2, 'mealDayOffset should be -2');

        const labelBefore = env.document.getElementById('meals-date-label').textContent;
        assert(labelBefore !== 'Hoy', 'Label before refresh should not be Hoy');

        // Auto-refresh triggers
        await env.sandbox.loadAll();

        // Verify offset and label are STILL preserved
        assert.strictEqual(env.sandbox.mealDayOffset, -2, 'mealDayOffset MUST remain -2 after auto-refresh');
        const labelAfter = env.document.getElementById('meals-date-label').textContent;
        assert.strictEqual(labelAfter, labelBefore, `meals-date-label must remain preserved after auto-refresh`);

        // Verify meals displayed are for -2 days ago
        const tbody = env.document.getElementById('meals-body').textContent;
        assert(tbody.includes('Comida Pasado'), `Meals table should show meals for -2 days ago`);

        // Now verify user switch explicitly resets to 0
        env.sandbox.selectUser(MAMA_ID);
        assert.strictEqual(env.sandbox.mealDayOffset, 0, 'selectUser MUST reset mealDayOffset to 0');
    });

    await test('4.3 Chart and Donut instances are destroyed and recreated cleanly without memory leaks', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                comidas: [createMeal({ dayOffset: 0, calorias: 600 })]
            }
        });
        env.runScript();

        let destroyCount = 0;
        // Monkey-patch Chart prototype to spy on destroy calls
        const originalChart = env.sandbox.Chart;
        env.sandbox.Chart = function(ctx, config) {
            const instance = new originalChart(ctx, config);
            const origDestroy = instance.destroy.bind(instance);
            instance.destroy = function() {
                destroyCount++;
                return origDestroy();
            };
            return instance;
        };

        // Load 10 times
        for (let i = 0; i < 10; i++) {
            await env.sandbox.loadAll();
        }

        // Each reload renders 4 bar charts + 1 donut = 5 charts.
        // Reload 2..10 (9 reloads) should call destroy on previous 5 charts each time = 45 destroys.
        assert(destroyCount >= 40, `Expected at least 40 destroy() calls across 10 loads, got: ${destroyCount}`);
    });

    // ------------------------------------------------------------------
    // SUITE 5: Resilience & Error Handling
    // ------------------------------------------------------------------
    console.log(`\n--- SUITE 5: Resilience & Error Fallbacks ---`);

    await test('5.1 Supabase metas error falls back safely without unhandled promise rejection', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                forceError: { message: 'Network timeout on metas', code: 504 }
            }
        });
        env.runScript();

        // Should not throw
        await env.sandbox.loadAll();

        // Verify fallback goals were loaded
        assert.strictEqual(env.sandbox.USUARIOS[NACHO_ID].cal, env.sandbox.USUARIOS_DEFAULT[NACHO_ID].cal);
        assert.strictEqual(Number(env.document.getElementById('cal-meta').textContent), 2300);
    });

    await test('5.2 Supabase metas empty [] falls back to immutable default', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                metas: [], // Zero rows in metas
                comidas: []
            }
        });
        env.runScript();
        await env.sandbox.loadAll();

        assert.strictEqual(env.sandbox.USUARIOS[NACHO_ID].cal, 2300);
        assert.strictEqual(env.sandbox.USUARIOS[MAMA_ID].cal, 1680);
    });

    await test('5.3 Concurrency stress: 10 parallel loadAll invocations resolve safely', async () => {
        const env = createNutriNachoEnvironment({
            silent: true,
            supabase: {
                comidas: [createMeal({ dayOffset: 0, calorias: 2300, proteina_g: 185 })]
            }
        });
        env.runScript();

        // Fire 10 loadAll calls concurrently without waiting
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(env.sandbox.loadAll());
        }

        await Promise.all(promises);

        // State is coherent
        const calActual = env.document.getElementById('cal-actual').textContent;
        assert.strictEqual(Number(calActual), 2300, `Expected cal-actual 2300, got: ${calActual}`);
    });

    // ------------------------------------------------------------------
    // SUMMARY
    // ------------------------------------------------------------------
    console.log(`\n======================================================================`);
    console.log(`                     STRESS TEST SUMMARY                              `);
    console.log(`======================================================================`);
    console.log(` Total Executed : ${passed + failed}`);
    console.log(` Passed         : \x1b[32m${passed}\x1b[0m`);
    console.log(` Failed         : ${failed > 0 ? `\x1b[31m${failed}\x1b[0m` : `0`}`);
    console.log(` Pass Rate      : ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    console.log(`======================================================================\n`);

    if (failed > 0) {
        console.error(`Failures detail:`);
        failures.forEach(f => console.error(`- ${f.name}: ${f.error.message}`));
        process.exit(1);
    } else {
        console.log(`All empirical stress tests passed with 100% success!`);
        process.exit(0);
    }
}

runAllStressTests().catch(err => {
    console.error('Fatal stress suite runner error:', err);
    process.exit(1);
});
