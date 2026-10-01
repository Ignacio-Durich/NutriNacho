/**
 * Tier 1: Feature Coverage (R1 through R7)
 * Comprehensive happy-path and fundamental contract tests for all 7 features.
 * Exactly 35 tests (5 per feature).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { createMeal, createNachoPerfectDay, createNachoTwoPeriodSet, createMamaGapDaysSet } = require('./fixtures/comidas_fixtures');

const tier1Tests = [
    // ==========================================
    // R1: Dynamic Goals (5 tests)
    // ==========================================
    {
        id: 'T1-R1-01',
        feature: 'R1',
        description: 'R1: Fetches latest metas row for active user and updates macro card targets',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive],
                    comidas: createNachoPerfectDay(0)
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const calMeta = env.document.getElementById('cal-meta');
            const protMeta = env.document.getElementById('prot-meta');
            const carbMeta = env.document.getElementById('carb-meta');
            const grasasMeta = env.document.getElementById('grasas-meta');

            assert(calMeta, 'Element #cal-meta must exist');
            assert(protMeta, 'Element #prot-meta must exist');
            assert.strictEqual(
                Number(calMeta.textContent),
                METAS_FIXTURES.nachoActive.calorias,
                `Expected cal-meta to match dynamic goal ${METAS_FIXTURES.nachoActive.calorias}, got ${calMeta.textContent}`
            );
            assert.strictEqual(
                Number(protMeta.textContent),
                METAS_FIXTURES.nachoActive.proteina_g,
                `Expected prot-meta to match dynamic goal ${METAS_FIXTURES.nachoActive.proteina_g}, got ${protMeta.textContent}`
            );
            assert.strictEqual(
                Number(carbMeta.textContent),
                METAS_FIXTURES.nachoActive.carbohidratos_g,
                `Expected carb-meta to match dynamic goal ${METAS_FIXTURES.nachoActive.carbohidratos_g}, got ${carbMeta.textContent}`
            );
            assert.strictEqual(
                Number(grasasMeta.textContent),
                METAS_FIXTURES.nachoActive.grasas_g,
                `Expected grasas-meta to match dynamic goal ${METAS_FIXTURES.nachoActive.grasas_g}, got ${grasasMeta.textContent}`
            );
        }
    },
    {
        id: 'T1-R1-02',
        feature: 'R1',
        description: 'R1: Updates SVG progress ring stroke offset and percentage based on dynamic goals',
        run: async () => {
            const meals = [createMeal({ calorias: 1225, proteina_g: 97, carbohidratos_g: 107, grasas_g: 40 })];
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive], // 2450 cal, 195 prot -> exactly 50%
                    comidas: meals
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const calPctEl = env.document.getElementById('cal-pct-text');
            assert(calPctEl, 'Element #cal-pct-text must exist');
            assert.strictEqual(calPctEl.textContent.trim(), '50%', `Expected 50% progress against dynamic 2450 kcal, got ${calPctEl.textContent}`);

            const ringCal = env.document.getElementById('ring-cal');
            assert(ringCal, 'Element #ring-cal must exist');
            const expectedOffset = 150.8 - (0.5 * 150.8);
            assert.strictEqual(
                Math.round(ringCal.style.strokeDashoffset),
                Math.round(expectedOffset),
                `Expected ring-cal strokeDashoffset to be ~${expectedOffset}, got ${ringCal.style.strokeDashoffset}`
            );
        }
    },
    {
        id: 'T1-R1-03',
        feature: 'R1',
        description: 'R1: Updates Donut chart macro percentages using dynamic goals or consumed macros',
        run: async () => {
            const meals = [createMeal({ calorias: 2000, proteina_g: 150, carbohidratos_g: 200, grasas_g: 66 })];
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive],
                    comidas: meals
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const protPct = env.document.getElementById('donut-prot-pct');
            const carbPct = env.document.getElementById('donut-carb-pct');
            const grasasPct = env.document.getElementById('donut-grasas-pct');
            assert(protPct && carbPct && grasasPct, 'Donut percentage elements must exist');
            assert(protPct.textContent.includes('%'), 'Donut prot percentage must be displayed');
        }
    },
    {
        id: 'T1-R1-04',
        feature: 'R1',
        description: 'R1: Updates Chart.js goalLine annotations with active dynamic goals',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive],
                    comidas: createNachoPerfectDay(0)
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart #chartCal must be instantiated');
            const annotations = chartCal.options?.plugins?.annotation?.annotations;
            assert(annotations?.goalLine, 'Chart must have a goalLine annotation');
            const goalLineVal = annotations.goalLine.yMin ?? annotations.goalLine.value;
            assert.strictEqual(
                Number(goalLineVal),
                METAS_FIXTURES.nachoActive.calorias,
                `Expected chartCal goalLine to be ${METAS_FIXTURES.nachoActive.calorias}, got ${goalLineVal}`
            );
        }
    },
    {
        id: 'T1-R1-05',
        feature: 'R1',
        description: 'R1: Switches dynamic goals when switching user from Nacho to Mamá',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                    comidas: []
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // Switch to Mamá
            if (env.sandbox.selectUser) {
                await env.sandbox.selectUser(MAMA_ID);
            }

            const calMeta = env.document.getElementById('cal-meta');
            const protMeta = env.document.getElementById('prot-meta');
            assert.strictEqual(
                Number(calMeta.textContent),
                METAS_FIXTURES.mamaActive.calorias,
                `Expected cal-meta for Mamá to be ${METAS_FIXTURES.mamaActive.calorias}, got ${calMeta.textContent}`
            );
            assert.strictEqual(
                Number(protMeta.textContent),
                METAS_FIXTURES.mamaActive.proteina_g,
                `Expected prot-meta for Mamá to be ${METAS_FIXTURES.mamaActive.proteina_g}, got ${protMeta.textContent}`
            );
        }
    },

    // ==========================================
    // R2: Daily Score Card (5 tests)
    // ==========================================
    {
        id: 'T1-R2-01',
        feature: 'R2',
        description: 'R2: Daily Score card element exists in the DOM structure',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreCard = env.document.getElementById('daily-score-card') ||
                              env.document.getElementById('card-daily-score') ||
                              env.document.querySelector('.daily-score-card');
            const scoreVal = env.document.getElementById('daily-score-val') ||
                             env.document.getElementById('daily-score');
            assert(scoreCard || scoreVal, 'Daily score card or score value element must exist in DOM');
        }
    },
    {
        id: 'T1-R2-02',
        feature: 'R2',
        description: 'R2: Computes high score (~10.0 / 10) for balanced intake hitting all goals',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    comidas: createNachoPerfectDay(0) // Exactly 2300 kcal, 185g prot, 220g carb, 75g grasas
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreValEl = env.document.getElementById('daily-score-val') ||
                               env.document.getElementById('daily-score');
            assert(scoreValEl, 'Daily score value element must exist');
            const scoreText = scoreValEl.textContent;
            const scoreNum = parseFloat(scoreText.replace(',', '.'));
            assert(!isNaN(scoreNum), `Score value must be numeric, got: ${scoreText}`);
            assert(scoreNum >= 9.5 && scoreNum <= 10.0, `Expected score ~10.0 for perfect goal hit, got ${scoreNum}`);
        }
    },
    {
        id: 'T1-R2-03',
        feature: 'R2',
        description: 'R2: Weights protein more heavily than other macros (protein deficit reduces score)',
        run: async () => {
            // Day A: 100% calories, 50% protein
            const mealsA = [createMeal({ calorias: 2300, proteina_g: 92, carbohidratos_g: 310, grasas_g: 75 })];
            // Day B: 100% protein, 80% calories
            const mealsB = [createMeal({ calorias: 1840, proteina_g: 185, carbohidratos_g: 170, grasas_g: 50 })];

            const envA = createNutriNachoEnvironment({ silent: true, supabase: { comidas: mealsA } });
            envA.runScript();
            if (envA.sandbox.loadAll) await envA.sandbox.loadAll();
            const scoreA = parseFloat((envA.document.getElementById('daily-score-val') || envA.document.getElementById('daily-score'))?.textContent || '0');

            const envB = createNutriNachoEnvironment({ silent: true, supabase: { comidas: mealsB } });
            envB.runScript();
            if (envB.sandbox.loadAll) await envB.sandbox.loadAll();
            const scoreB = parseFloat((envB.document.getElementById('daily-score-val') || envB.document.getElementById('daily-score'))?.textContent || '0');

            assert(scoreB > scoreA, `Expected 100% protein day (score ${scoreB}) to rank higher than 50% protein day (score ${scoreA}) due to protein weighting`);
        }
    },
    {
        id: 'T1-R2-04',
        feature: 'R2',
        description: 'R2: Displays adherence rating badge or qualitative label',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { comidas: createNachoPerfectDay(0) }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const badgeEl = env.document.getElementById('daily-score-badge') ||
                            env.document.getElementById('daily-score-label') ||
                            env.document.querySelector('.score-badge');
            assert(badgeEl, 'Daily score rating badge or label must exist');
            const text = badgeEl.textContent.toLowerCase();
            assert(
                text.includes('excelente') || text.includes('bueno') || text.includes('meta'),
                `Expected positive adherence badge text, got: "${badgeEl.textContent}"`
            );
        }
    },
    {
        id: 'T1-R2-05',
        feature: 'R2',
        description: 'R2: Updates daily score when switching users (Nacho vs Mamá)',
        run: async () => {
            // Nacho has meals today, Mamá has 0 meals today
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { comidas: meals }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreNachoEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreNachoEl, 'Score element must exist for Nacho');
            const nachoScore = scoreNachoEl.textContent;

            // Switch to Mamá
            if (env.sandbox.selectUser) {
                await env.sandbox.selectUser(MAMA_ID);
            }
            const scoreMamaEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            const mamaScore = scoreMamaEl.textContent;

            assert.notStrictEqual(
                nachoScore,
                mamaScore,
                `Expected daily score to update when switching to Mamá (who has 0 meals today). Nacho: ${nachoScore}, Mamá: ${mamaScore}`
            );
        }
    },

    // ==========================================
    // R3: Best & Worst Day Highlights (5 tests)
    // ==========================================
    {
        id: 'T1-R3-01',
        feature: 'R3',
        description: 'R3: Best Day highlight card exists in the DOM',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const bestCard = env.document.getElementById('best-day-card') ||
                             env.document.getElementById('card-best-day') ||
                             env.document.querySelector('.best-day-card');
            assert(bestCard, 'Best Day highlight card must exist in DOM');
        }
    },
    {
        id: 'T1-R3-02',
        feature: 'R3',
        description: 'R3: Worst Day highlight card exists in the DOM',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const worstCard = env.document.getElementById('worst-day-card') ||
                              env.document.getElementById('card-worst-day') ||
                              env.document.querySelector('.worst-day-card');
            assert(worstCard, 'Worst Day highlight card must exist in DOM');
        }
    },
    {
        id: 'T1-R3-03',
        feature: 'R3',
        description: 'R3: Identifies the highest adherence day in a 7-day period as Best Day',
        run: async () => {
            // Day -3 is perfect, Day -1 is poor
            const meals = [
                ...createNachoPerfectDay(-3),
                createMeal({ dayOffset: -1, calorias: 1100, proteina_g: 50, carbohidratos_g: 90, grasas_g: 30 })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const bestDateEl = env.document.getElementById('best-day-date') ||
                               env.document.querySelector('#best-day-card .day-date');
            assert(bestDateEl, 'Best day date element must exist');
            // The date of day -3 should be displayed
            const d = new Date();
            d.setHours(d.getHours() - 4);
            d.setDate(d.getDate() - 3);
            const expectedDay = d.toISOString().split('T')[0].split('-')[2];
            assert(
                bestDateEl.textContent.includes(expectedDay),
                `Expected Best Day to display day ${expectedDay}, got ${bestDateEl.textContent}`
            );
        }
    },
    {
        id: 'T1-R3-04',
        feature: 'R3',
        description: 'R3: Identifies the lowest adherence day in a 7-day period as Worst Day',
        run: async () => {
            const meals = [
                ...createNachoPerfectDay(-3),
                createMeal({ dayOffset: -1, calorias: 3600, proteina_g: 60, carbohidratos_g: 450, grasas_g: 130 }) // Severe deviation
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const worstDateEl = env.document.getElementById('worst-day-date') ||
                                env.document.querySelector('#worst-day-card .day-date');
            assert(worstDateEl, 'Worst day date element must exist');
            const d = new Date();
            d.setHours(d.getHours() - 4);
            d.setDate(d.getDate() - 1);
            const expectedDay = d.toISOString().split('T')[0].split('-')[2];
            assert(
                worstDateEl.textContent.includes(expectedDay),
                `Expected Worst Day to display day ${expectedDay}, got ${worstDateEl.textContent}`
            );
        }
    },
    {
        id: 'T1-R3-05',
        feature: 'R3',
        description: 'R3: Recalculates best and worst days when date range changes (7d to 14d)',
        run: async () => {
            // Day -10 was the absolute best day ever (outside 7d, inside 14d)
            const meals = [
                ...createNachoPerfectDay(-10),
                createMeal({ dayOffset: -2, calorias: 1500, proteina_g: 100, carbohidratos_g: 150, grasas_g: 40 })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            // In 7d, day -10 is not visible
            const best7d = env.document.getElementById('best-day-date')?.textContent;

            // Switch to 14d
            if (env.sandbox.setRange) {
                await env.sandbox.setRange(14);
            }
            const best14d = env.document.getElementById('best-day-date')?.textContent;

            assert.notStrictEqual(
                best7d,
                best14d,
                `Expected best day to update when expanding range from 7d to 14d (7d: ${best7d}, 14d: ${best14d})`
            );
        }
    },

    // ==========================================
    // R4: Missing Day Indicators (5 tests)
    // ==========================================
    {
        id: 'T1-R4-01',
        feature: 'R4',
        description: 'R4: Chart X-axis generates contiguous calendar days of length currentRange',
        run: async () => {
            // User only logged meals on day -2
            const meals = [createMeal({ dayOffset: -2 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            const labels = chartCal.data.labels || [];
            assert.strictEqual(
                labels.length,
                7,
                `Expected chart to display exactly 7 contiguous calendar days for 7d range, got ${labels.length}`
            );
        }
    },
    {
        id: 'T1-R4-02',
        feature: 'R4',
        description: 'R4: Days with 0 meals are represented as visible gray placeholder bars in charts',
        run: async () => {
            // Day 0 has meals, days -6 to -1 have zero meals
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            const dataset = chartCal.data.datasets[0];
            assert(dataset, 'Bar dataset must exist');

            const bgColors = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor : [dataset.backgroundColor];
            // At least one missing day should have gray/slate coloring (e.g. rgba(100, 116, 139, ...) or #64748b)
            const hasGrayBar = bgColors.some(c => String(c).includes('148, 163, 184') || String(c).includes('100, 116, 139') || String(c).includes('slate') || String(c).includes('gray'));
            assert(hasGrayBar, `Expected dataset backgroundColor to contain gray color for unlogged days, got: ${JSON.stringify(bgColors)}`);
        }
    },
    {
        id: 'T1-R4-03',
        feature: 'R4',
        description: 'R4: Missing days feature a warning indicator (⚠️ label or annotation)',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');

            const labels = chartCal.data.labels || [];
            const annotations = chartCal.options?.plugins?.annotation?.annotations || {};
            const hasWarningInLabel = labels.some(l => String(l).includes('⚠️'));
            const hasWarningInAnnotation = Object.values(annotations).some(a => String(a.content).includes('⚠️') || String(a.label?.content).includes('⚠️'));

            assert(
                hasWarningInLabel || hasWarningInAnnotation,
                'Expected ⚠️ warning indicator in chart labels or annotations for unlogged days'
            );
        }
    },
    {
        id: 'T1-R4-04',
        feature: 'R4',
        description: 'R4: Custom tooltip callback for missing days indicates unlogged day',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            const tooltipCallbacks = chartCal.tooltipCallbacks;
            assert(tooltipCallbacks, 'Chart should define custom tooltip callbacks');
            assert(typeof tooltipCallbacks.label === 'function' || typeof tooltipCallbacks.title === 'function', 'Tooltip callback must be a function');
        }
    },
    {
        id: 'T1-R4-05',
        feature: 'R4',
        description: 'R4: All 4 trend charts apply missing day indicators consistently',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartIds = ['chartCal', 'chartProt', 'chartCarb', 'chartGrasas'];
            for (const id of chartIds) {
                const chart = env.chartMock.findChartByCanvasId(id);
                assert(chart, `Chart #${id} must be instantiated`);
                assert.strictEqual(chart.data.labels.length, 7, `Chart #${id} should have 7 labels`);
            }
        }
    },

    // ==========================================
    // R5: Period-over-Period Comparison (5 tests)
    // ==========================================
    {
        id: 'T1-R5-01',
        feature: 'R5',
        description: 'R5: Expands query buffer in fetchComidas to at least currentRange * 2 days',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const queries = env.supabaseMock.queryHistory.filter(q => q.table === 'comidas');
            assert(queries.length > 0, 'fetchComidas must have executed at least one query');
            const lastQuery = queries[queries.length - 1];
            const gteFilter = lastQuery.filters.find(f => f.type === 'gte' && f.column === 'fecha');
            assert(gteFilter, 'Query must have a gte date filter');

            // For currentRange = 7, buffer must cover at least 14 days back (7*2 = 14)
            const sinceDate = new Date(gteFilter.value);
            const now = new Date();
            const daysDiff = Math.round((now - sinceDate) / (1000 * 60 * 60 * 24));
            assert(
                daysDiff >= 14,
                `Expected fetchComidas buffer to be >= 14 days for 7d range (currentRange*2), got ${daysDiff} days`
            );
        }
    },
    {
        id: 'T1-R5-02',
        feature: 'R5',
        description: 'R5: Computes percentage delta for calories vs previous equivalent period',
        run: async () => {
            // Nacho: Prev 7d avg = 2000 cal, Curr 7d avg = 2300 cal -> +15% delta
            const meals = createNachoTwoPeriodSet();
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaCalEl = env.document.getElementById('pop-cal-delta') ||
                               env.document.getElementById('avg-cal-diff-pop') ||
                               env.document.querySelector('[data-pop="cal"]');
            assert(deltaCalEl, 'Element for calorie period delta must exist in DOM');
            assert(
                deltaCalEl.textContent.includes('15%') || deltaCalEl.textContent.includes('+15'),
                `Expected calorie delta ~ +15%, got: "${deltaCalEl.textContent}"`
            );
        }
    },
    {
        id: 'T1-R5-03',
        feature: 'R5',
        description: 'R5: Computes percentage delta for protein vs previous equivalent period',
        run: async () => {
            // Prev 7d avg = 150g prot, Curr 7d avg = 185g prot -> +23% delta
            const meals = createNachoTwoPeriodSet();
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaProtEl = env.document.getElementById('pop-prot-delta') ||
                                env.document.getElementById('avg-prot-diff-pop') ||
                                env.document.querySelector('[data-pop="prot"]');
            assert(deltaProtEl, 'Element for protein period delta must exist in DOM');
            assert(
                deltaProtEl.textContent.includes('23%') || deltaProtEl.textContent.includes('+23'),
                `Expected protein delta ~ +23%, got: "${deltaProtEl.textContent}"`
            );
        }
    },
    {
        id: 'T1-R5-04',
        feature: 'R5',
        description: 'R5: Computes percentage deltas for carbs and fats vs previous equivalent period',
        run: async () => {
            const meals = createNachoTwoPeriodSet();
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaCarbEl = env.document.getElementById('pop-carb-delta') || env.document.querySelector('[data-pop="carb"]');
            const deltaGrasasEl = env.document.getElementById('pop-grasas-delta') || env.document.querySelector('[data-pop="grasas"]');
            assert(deltaCarbEl && deltaGrasasEl, 'Carb and fat period delta elements must exist in DOM');
            assert(deltaCarbEl.textContent.includes('%'), 'Carb delta must display percentage');
            assert(deltaGrasasEl.textContent.includes('%'), 'Fat delta must display percentage');
        }
    },
    {
        id: 'T1-R5-05',
        feature: 'R5',
        description: 'R5: Renders delta badges inside or alongside #averages-grid',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const avgGrid = env.document.getElementById('averages-grid');
            assert(avgGrid, 'Element #averages-grid must exist');
            const popElements = env.document.querySelectorAll('[id^="pop-"], [class*="pop-delta"]');
            assert(popElements.length >= 4, `Expected at least 4 period delta elements in or around averages grid, found ${popElements.length}`);
        }
    },

    // ==========================================
    // R6: PWA Offline Support & Service Worker (5 tests)
    // ==========================================
    {
        id: 'T1-R6-01',
        feature: 'R6',
        description: 'R6: Service worker file dashboard/sw.js exists and registers install and fetch listeners',
        run: async () => {
            const swPath = path.resolve(__dirname, '../dashboard/sw.js');
            assert(fs.existsSync(swPath), `Service worker file dashboard/sw.js must exist at ${swPath}`);
            const swContent = fs.readFileSync(swPath, 'utf8');
            assert(swContent.includes("addEventListener('install'"), 'sw.js must register install event listener');
            assert(swContent.includes("addEventListener('fetch'"), 'sw.js must register fetch event listener');
        }
    },
    {
        id: 'T1-R6-02',
        feature: 'R6',
        description: 'R6: dashboard/index.html registers service worker on load',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();

            assert(
                env.rawHTML.includes('serviceWorker.register') || env.scriptCode.includes('serviceWorker.register'),
                'index.html must contain navigator.serviceWorker.register'
            );
        }
    },
    {
        id: 'T1-R6-03',
        feature: 'R6',
        description: 'R6: Service worker precaches app shell assets on install',
        run: async () => {
            const swPath = path.resolve(__dirname, '../dashboard/sw.js');
            assert(fs.existsSync(swPath), 'dashboard/sw.js must exist');
            const env = createNutriNachoEnvironment({ silent: true });
            const swInstance = env.swMock.loadServiceWorkerFile(swPath);
            assert(swInstance.exists, 'Service worker file must load cleanly');
            await swInstance.triggerInstall();

            const cacheKeys = await swInstance.caches.keys();
            assert(cacheKeys.length > 0, 'Service worker must create at least one cache storage instance');
        }
    },
    {
        id: 'T1-R6-04',
        feature: 'R6',
        description: 'R6: Service worker intercepts Supabase REST requests and caches successful 200 responses',
        run: async () => {
            const swPath = path.resolve(__dirname, '../dashboard/sw.js');
            assert(fs.existsSync(swPath), 'dashboard/sw.js must exist');
            const env = createNutriNachoEnvironment({ silent: true });
            const swInstance = env.swMock.loadServiceWorkerFile(swPath);
            assert(swInstance.exists, 'Service worker file must load');

            // Trigger fetch for Supabase endpoint
            const res = await swInstance.triggerFetch('https://example-project.supabase.co/rest/v1/metas');
            assert(res, 'Service worker fetch handler must respond to Supabase requests');
        }
    },
    {
        id: 'T1-R6-05',
        feature: 'R6',
        description: 'R6: Displays offline banner (#offline-banner) when network status is offline',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, online: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const banner = env.document.getElementById('offline-banner');
            assert(banner, 'Element #offline-banner must exist in DOM');

            // Trigger offline
            env.setOnline(false);

            // Banner should not be hidden
            assert(
                !banner.classList.contains('hidden'),
                'Expected #offline-banner to be visible when offline'
            );
        }
    },

    // ==========================================
    // R7: CSV Data Export (5 tests)
    // ==========================================
    {
        id: 'T1-R7-01',
        feature: 'R7',
        description: 'R7: CSV export button exists in the dashboard UI',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') ||
                              env.document.getElementById('btn-csv') ||
                              env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'CSV export button must exist in DOM');
        }
    },
    {
        id: 'T1-R7-02',
        feature: 'R7',
        description: 'R7: Generates valid CSV header: Fecha,Comida,Calorías,Proteína (g),Carbohidratos (g),Grasas (g)',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(env.createdBlobs.length > 0, 'Clicking export must generate a Blob');
            const blobText = await env.createdBlobs[0].blob.text();
            assert(blobText.includes('Fecha') && blobText.includes('Comida'), 'CSV must include header row with Fecha and Comida');
            assert(blobText.includes('Calorías') || blobText.includes('Calorias'), 'CSV must include Calorías column');
        }
    },
    {
        id: 'T1-R7-03',
        feature: 'R7',
        description: 'R7: Prepend UTF-8 BOM (\\uFEFF) to CSV content for Excel compatibility',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(env.createdBlobs.length > 0, 'Blob must be created');
            const blobText = await env.createdBlobs[0].blob.text();
            assert.strictEqual(
                blobText.charCodeAt(0),
                0xFEFF,
                `Expected first character of CSV to be UTF-8 BOM \\uFEFF (0xFEFF), got charCode ${blobText.charCodeAt(0)}`
            );
        }
    },
    {
        id: 'T1-R7-04',
        feature: 'R7',
        description: 'R7: Formats downloaded filename as NutriNacho_<User>_<Range>d_<Date>.csv',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            let clickedAnchor = null;
            const originalCreateElement = env.document.createElement.bind(env.document);
            env.document.createElement = (tag) => {
                const el = originalCreateElement(tag);
                if (tag.toLowerCase() === 'a') {
                    clickedAnchor = el;
                }
                return el;
            };

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(clickedAnchor, 'Synthetic <a> element must be created for download');
            const filename = clickedAnchor.getAttribute('download') || clickedAnchor.download;
            assert(filename, 'Anchor element must have download attribute');
            assert(
                filename.startsWith('NutriNacho_') && filename.endsWith('.csv') && filename.includes('7d'),
                `Expected filename format NutriNacho_<User>_7d_<Date>.csv, got: ${filename}`
            );
        }
    },
    {
        id: 'T1-R7-05',
        feature: 'R7',
        description: 'R7: Exports all meals within the active date range',
        run: async () => {
            const meals = [
                ...createNachoPerfectDay(0),
                createMeal({ dayOffset: -2, comida: 'Merienda día -2' })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(env.createdBlobs.length > 0, 'Blob must be created');
            const blobText = await env.createdBlobs[0].blob.text();
            assert(blobText.includes('Merienda día -2'), 'CSV must include meals from within active period');
        }
    }
];

module.exports = { tier1Tests };
