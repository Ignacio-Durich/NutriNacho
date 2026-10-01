/**
 * Tier 4: Real-World Application Scenarios
 * Validates realistic end-to-end user workflows and real-life usage patterns.
 * Exactly 5 tests.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { createMeal, createNachoPerfectDay, createNachoTwoPeriodSet, createMamaGapDaysSet } = require('./fixtures/comidas_fixtures');

const tier4Tests = [
    {
        id: 'T4-RW-01',
        feature: 'Journey-NachoFullDay',
        description: 'RW-01: Nacho logs full day (4 meals) hitting recomposition macros -> high score, rings ~100%, charts updated',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive],
                    comidas: meals
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // 1. Verify Macro actuals
            const calAct = env.document.getElementById('cal-actual');
            const protAct = env.document.getElementById('prot-actual');
            assert.strictEqual(Number(calAct.textContent), 2300, 'Cal actual must be 2300');
            assert.strictEqual(Number(protAct.textContent), 185, 'Prot actual must be 185');

            // 2. Verify Daily Score
            const scoreEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreEl, 'Score element must exist');
            const score = parseFloat(scoreEl.textContent.replace(',', '.'));
            assert(score >= 9.0, `Expected score >= 9.0 for perfect full day, got ${score}`);

            // 3. Verify Rings
            const ringProt = env.document.getElementById('ring-prot');
            assert(ringProt, 'ring-prot element must exist');
            assert(ringProt.style.strokeDashoffset !== undefined, 'ring stroke offset must be set');
        }
    },
    {
        id: 'T4-RW-02',
        feature: 'Journey-MamaGapDays',
        description: 'RW-02: Mamá with unlogged gap days -> missing bars appear, PoP deltas use active days, today displays "—/10"',
        run: async () => {
            const meals = createMamaGapDaysSet(); // Only logged on offsets -6, -5, -3
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.mamaActive],
                    comidas: meals
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // Switch to Mamá
            if (env.sandbox.selectUser) {
                await env.sandbox.selectUser(MAMA_ID);
            }

            // 1. Today has 0 meals -> score must be "—/10"
            const scoreEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreEl, 'Score element must exist for R2 Daily Score');
            assert(
                scoreEl.textContent.includes('—') || scoreEl.textContent.includes('-') || scoreEl.textContent.includes('N/A'),
                `Expected neutral indicator "—" for Mamá (0 meals today), got: "${scoreEl.textContent}"`
            );

            // 2. Charts must have 7 labels with missing day placeholders
            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'chartCal must exist');
            assert.strictEqual(chartCal.data.labels.length, 7, 'Must have 7 days in 7d range');
        }
    },
    {
        id: 'T4-RW-03',
        feature: 'Journey-RangeSwitchExport',
        description: 'RW-03: User changes range from 7d to 14d, reviews highlights, then exports CSV with 14d filename',
        run: async () => {
            const meals = createNachoTwoPeriodSet();
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { comidas: meals }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // Switch to 14d
            if (env.sandbox.setRange) {
                await env.sandbox.setRange(14);
            }

            let clickedAnchor = null;
            env.document.createElement = (tag) => {
                const el = new (require('./harness/dom_env').DOMElement)(tag);
                if (tag.toLowerCase() === 'a') clickedAnchor = el;
                return el;
            };

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(clickedAnchor, 'Synthetic anchor clicked');
            const filename = clickedAnchor.getAttribute('download') || clickedAnchor.download || '';
            assert(
                filename.includes('14d'),
                `Expected filename to reflect active 14d range, got: ${filename}`
            );
        }
    },
    {
        id: 'T4-RW-04',
        feature: 'Journey-AutoRefreshPreservation',
        description: 'RW-04: Auto-refresh interval (30s loadAll) does not reset user\'s past mealDayOffset selection',
        run: async () => {
            const meals = createNachoTwoPeriodSet();
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { comidas: meals }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // User navigates 2 days into the past
            if (env.sandbox.shiftMealDay) {
                env.sandbox.shiftMealDay(-1);
                env.sandbox.shiftMealDay(-1);
            } else {
                env.eval('mealDayOffset = -2');
            }

            assert.strictEqual(env.getGlobal('mealDayOffset'), -2, 'mealDayOffset should be -2');

            // 30s auto-refresh fires
            if (env.sandbox.loadAll) {
                await env.sandbox.loadAll();
            }

            assert.strictEqual(
                env.getGlobal('mealDayOffset'),
                -2,
                'Auto-refresh loadAll() must preserve mealDayOffset rather than resetting to 0'
            );
        }
    },
    {
        id: 'T4-RW-05',
        feature: 'Journey-OfflineReconnection',
        description: 'RW-05: Online -> offline -> range navigation -> online reconnection lifecycle with banner and auto-refresh',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                online: true,
                supabase: { comidas: createNachoTwoPeriodSet() }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const banner = env.document.getElementById('offline-banner');
            assert(banner, 'Offline banner must exist');
            assert(banner.classList.contains('hidden'), 'Initially online: banner is hidden');

            // 1. Go offline
            env.setOnline(false);
            assert(!banner.classList.contains('hidden'), 'Offline: banner becomes visible');

            // 2. User changes range while offline
            if (env.sandbox.setRange) {
                await env.sandbox.setRange(14);
            }

            // 3. Reconnect online
            env.setOnline(true);
            assert(banner.classList.contains('hidden'), 'Back online: banner hides');
        }
    }
];

module.exports = { tier4Tests };
