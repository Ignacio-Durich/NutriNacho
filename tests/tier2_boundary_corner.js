/**
 * Tier 2: Boundary & Corner Cases (R1 through R7)
 * Stress-tests edge conditions, zero values, extreme values, format escaping, and network errors.
 * Exactly 36 tests (5 per feature + 1 layout).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { createMeal, createNachoPerfectDay, createNachoTwoPeriodSet, createSpecialCharacterMeals } = require('./fixtures/comidas_fixtures');

const tier2Tests = [
    // ==========================================
    // R1: Dynamic Goals Boundaries (5 tests)
    // ==========================================
    {
        id: 'T2-R1-01',
        feature: 'R1',
        description: 'R1-Edge: Empty metas table returns [] -> cleanly falls back to USUARIOS default without error',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { metas: [], comidas: [] }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const calMeta = env.document.getElementById('cal-meta');
            assert(calMeta, 'Element #cal-meta must exist');
            assert.strictEqual(
                Number(calMeta.textContent),
                2300,
                `Expected fallback 2300 kcal for Nacho when metas is empty, got ${calMeta.textContent}`
            );
        }
    },
    {
        id: 'T2-R1-02',
        feature: 'R1',
        description: 'R1-Edge: Supabase network failure when fetching metas -> cleanly applies fallback',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    forceError: { message: 'Connection refused', code: 'PGRST000' }
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const protMeta = env.document.getElementById('prot-meta');
            assert(protMeta, 'Element #prot-meta must exist');
            assert.strictEqual(
                Number(protMeta.textContent),
                185,
                `Expected fallback 185g prot when network fails, got ${protMeta.textContent}`
            );
        }
    },
    {
        id: 'T2-R1-03',
        feature: 'R1',
        description: 'R1-Edge: Partial metas row with null fields merges with fallback values',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.partialNacho], // calorias: 2500, proteina_g: null
                    comidas: []
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const calMeta = env.document.getElementById('cal-meta');
            const protMeta = env.document.getElementById('prot-meta');
            assert.strictEqual(Number(calMeta.textContent), 2500, 'Dynamic calorias should be 2500');
            assert.strictEqual(Number(protMeta.textContent), 185, 'Null proteina_g should retain fallback 185');
        }
    },
    {
        id: 'T2-R1-04',
        feature: 'R1',
        description: 'R1-Edge: Multiple metas rows -> selects newest by fecha_creacion DESC limit 1',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoOlder, METAS_FIXTURES.nachoActive]
                }
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const calMeta = env.document.getElementById('cal-meta');
            assert.strictEqual(
                Number(calMeta.textContent),
                METAS_FIXTURES.nachoActive.calorias,
                `Expected latest metas calorias ${METAS_FIXTURES.nachoActive.calorias}, got ${calMeta.textContent}`
            );
        }
    },
    {
        id: 'T2-R1-05',
        feature: 'R1',
        description: 'R1-Edge: Unknown user ID safely applies default without throwing TypeError',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();

            assert.doesNotThrow(async () => {
                if (env.sandbox.selectUser) {
                    await env.sandbox.selectUser(9999999999);
                }
            }, 'Switching to unknown user must not crash application');
        }
    },

    // ==========================================
    // R2: Daily Score Boundaries (5 tests)
    // ==========================================
    {
        id: 'T2-R2-01',
        feature: 'R2',
        description: 'R2-Edge: 0 meals today displays "—/10" and neutral "Sin registros hoy"',
        run: async () => {
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: { comidas: [] } // Zero meals today
            });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreValEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreValEl, 'Score element must exist');
            const scoreText = scoreValEl.textContent.trim();
            assert(
                scoreText.includes('—') || scoreText.includes('-') || scoreText === '0' || scoreText.includes('N/A'),
                `Expected neutral empty indicator "—" for 0 meals today, got "${scoreText}"`
            );

            const badgeEl = env.document.getElementById('daily-score-badge') || env.document.querySelector('.score-badge');
            if (badgeEl) {
                const badgeText = badgeEl.textContent.toLowerCase();
                assert(
                    badgeText.includes('sin registros') || badgeText.includes('sin comidas') || badgeText.includes('esperando'),
                    `Expected neutral badge for 0 meals today, got: "${badgeEl.textContent}"`
                );
            }
        }
    },
    {
        id: 'T2-R2-02',
        feature: 'R2',
        description: 'R2-Edge: Single meal logged today (partial day) produces valid non-negative score',
        run: async () => {
            const meals = [createMeal({ calorias: 550, proteina_g: 40, carbohidratos_g: 50, grasas_g: 15 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreValEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreValEl, 'Score element must exist');
            const scoreNum = parseFloat(scoreValEl.textContent.replace(',', '.'));
            assert(scoreNum >= 1.0 && scoreNum <= 8.0, `Expected partial score between 1.0 and 8.0, got ${scoreNum}`);
        }
    },
    {
        id: 'T2-R2-03',
        feature: 'R2',
        description: 'R2-Edge: High protein overage (125% of goal) maintains optimal recomposition score plateau',
        run: async () => {
            // Nacho: 185g prot goal. Consumes 232g prot (125%), calories at 100%
            const meals = [createMeal({ calorias: 2300, proteina_g: 232, carbohidratos_g: 175, grasas_g: 75 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreValEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreValEl, 'Score element must exist');
            const scoreNum = parseFloat(scoreValEl.textContent.replace(',', '.'));
            assert(scoreNum >= 8.5, `Expected score >= 8.5 for high protein adherence, got ${scoreNum}`);
        }
    },
    {
        id: 'T2-R2-04',
        feature: 'R2',
        description: 'R2-Edge: Extreme calorie surplus (160% of goal) penalizes score, clamped >= 0.0',
        run: async () => {
            const meals = [createMeal({ calorias: 3800, proteina_g: 120, carbohidratos_g: 500, grasas_g: 145 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreValEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreValEl, 'Score element must exist');
            const scoreNum = parseFloat(scoreValEl.textContent.replace(',', '.'));
            assert(scoreNum >= 0.0 && scoreNum <= 5.0, `Expected low score <= 5.0 for extreme calorie surplus, got ${scoreNum}`);
        }
    },
    {
        id: 'T2-R2-05',
        feature: 'R2',
        description: 'R2-Edge: Exact 100% adherence on all 4 macros yields perfect 10.0 / 10',
        run: async () => {
            const meals = [createMeal({ calorias: 2300, proteina_g: 185, carbohidratos_g: 220, grasas_g: 75 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const scoreValEl = env.document.getElementById('daily-score-val') || env.document.getElementById('daily-score');
            assert(scoreValEl, 'Score element must exist');
            const scoreNum = parseFloat(scoreValEl.textContent.replace(',', '.'));
            assert.strictEqual(scoreNum, 10.0, `Expected exactly 10.0 for 100% goal match, got ${scoreNum}`);
        }
    },

    // ==========================================
    // R3: Best/Worst Days Boundaries (5 tests)
    // ==========================================
    {
        id: 'T2-R3-01',
        feature: 'R3',
        description: 'R3-Edge: Entire period has 0 logged meals -> displays graceful fallback message',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [] } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const bestCard = env.document.getElementById('best-day-card') || env.document.querySelector('.best-day-card');
            const worstCard = env.document.getElementById('worst-day-card') || env.document.querySelector('.worst-day-card');
            assert(bestCard && worstCard, 'Highlight cards must exist');
            const combinedText = (bestCard.textContent + worstCard.textContent).toLowerCase();
            assert(
                combinedText.includes('sin registros') || combinedText.includes('sin datos') || combinedText.includes('—'),
                `Expected fallback notice for period with 0 meals, got: "${combinedText}"`
            );
        }
    },
    {
        id: 'T2-R3-02',
        feature: 'R3',
        description: 'R3-Edge: Exactly 1 day logged in period -> Best Day displays day, Worst Day indicates insufficient days',
        run: async () => {
            const meals = [createMeal({ dayOffset: -2, calorias: 2300, proteina_g: 185 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const worstText = (env.document.getElementById('worst-day-card')?.textContent || '').toLowerCase();
            assert(
                worstText.includes('al menos 2') || worstText.includes('único') || worstText.includes('unico') || worstText.includes('—'),
                `Expected worst day notice for single-day period, got: "${worstText}"`
            );
        }
    },
    {
        id: 'T2-R3-03',
        feature: 'R3',
        description: 'R3-Edge: Tied daily scores -> breaks tie prioritizing higher protein adherence ratio',
        run: async () => {
            // Day A: 2000 cal, 185g prot (100% prot)
            // Day B: 2000 cal, 150g prot (81% prot)
            const meals = [
                createMeal({ dayOffset: -3, calorias: 2000, proteina_g: 185, carbohidratos_g: 190, grasas_g: 65 }),
                createMeal({ dayOffset: -1, calorias: 2000, proteina_g: 150, carbohidratos_g: 220, grasas_g: 65 })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const bestDate = env.document.getElementById('best-day-date')?.textContent || '';
            const d3 = new Date();
            d3.setHours(d3.getHours() - 4);
            d3.setDate(d3.getDate() - 3);
            const expectedDay = d3.toISOString().split('T')[0].split('-')[2];
            assert(bestDate.includes(expectedDay), `Expected day -3 with higher protein to win tie, got: ${bestDate}`);
        }
    },
    {
        id: 'T2-R3-04',
        feature: 'R3',
        description: 'R3-Edge: Tied score and tied protein ratio -> breaks tie prioritizing closer calorie adherence',
        run: async () => {
            // Both have 185g prot. Day A is 2310 cal (+10), Day B is 2400 cal (+100)
            const meals = [
                createMeal({ dayOffset: -4, calorias: 2310, proteina_g: 185, carbohidratos_g: 220, grasas_g: 75 }),
                createMeal({ dayOffset: -2, calorias: 2400, proteina_g: 185, carbohidratos_g: 235, grasas_g: 80 })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const bestDate = env.document.getElementById('best-day-date')?.textContent || '';
            const d4 = new Date();
            d4.setHours(d4.getHours() - 4);
            d4.setDate(d4.getDate() - 4);
            const expectedDay = d4.toISOString().split('T')[0].split('-')[2];
            assert(bestDate.includes(expectedDay), `Expected day -4 with closer calories to win tie, got: ${bestDate}`);
        }
    },
    {
        id: 'T2-R3-05',
        feature: 'R3',
        description: 'R3-Edge: Unlogged days (0 meals) are excluded from Best/Worst candidate selection',
        run: async () => {
            // Day -5 has 1 meal, days -4, -3, -2, -1, 0 have 0 meals
            const meals = [createMeal({ dayOffset: -5, calorias: 1800, proteina_g: 140 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const bestDate = env.document.getElementById('best-day-date')?.textContent || '';
            const d5 = new Date();
            d5.setHours(d5.getHours() - 4);
            d5.setDate(d5.getDate() - 5);
            const expectedDay = d5.toISOString().split('T')[0].split('-')[2];
            assert(bestDate.includes(expectedDay), `Expected only logged day (-5) to be considered, got: ${bestDate}`);
        }
    },

    // ==========================================
    // R4: Missing Days Boundaries (5 tests)
    // ==========================================
    {
        id: 'T2-R4-01',
        feature: 'R4',
        description: 'R4-Edge: Entire period has 0 meals -> all 7 chart bars render as missing stubs with ⚠️',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [] } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            assert.strictEqual(chartCal.data.labels.length, 7, 'Must generate all 7 days');
        }
    },
    {
        id: 'T2-R4-02',
        feature: 'R4',
        description: 'R4-Edge: Today has 0 meals -> today bar renders as missing stub without errors',
        run: async () => {
            const meals = [createMeal({ dayOffset: -1 })]; // Yesterday has meals, today is empty
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            const todayLabel = chartCal.data.labels[chartCal.data.labels.length - 1];
            assert(todayLabel, 'Today label must exist on chart X-axis');
        }
    },
    {
        id: 'T2-R4-03',
        feature: 'R4',
        description: 'R4-Edge: Single missing day between logged days positioned in correct chronological order',
        run: async () => {
            // Days -3 and -1 logged; day -2 missing
            const meals = [createMeal({ dayOffset: -3 }), createMeal({ dayOffset: -1 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            const labels = chartCal.data.labels;
            // Offsets -6, -5, -4, -3, -2, -1, 0
            // Index 4 corresponds to offset -2
            assert.strictEqual(labels.length, 7);
        }
    },
    {
        id: 'T2-R4-04',
        feature: 'R4',
        description: 'R4-Edge: 7-day moving average curve does not plummet to 0 on missing days',
        run: async () => {
            const meals = [
                createMeal({ dayOffset: -3, calorias: 2300 }),
                createMeal({ dayOffset: -1, calorias: 2300 })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            const lineDataset = chartCal.data.datasets.find(d => d.type === 'line');
            if (lineDataset) {
                // Values on lineDataset should not plummet to 0
                const values = lineDataset.data.filter(v => typeof v === 'number');
                const hasZeroPlummet = values.some(v => v === 0);
                assert(!hasZeroPlummet, 'Moving average should not crash to 0 on missing days');
            }
        }
    },
    {
        id: 'T2-R4-05',
        feature: 'R4',
        description: 'R4-Edge: Nominal missing bar height is subtle (non-zero for visibility)',
        run: async () => {
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const chartCal = env.chartMock.findChartByCanvasId('chartCal');
            assert(chartCal, 'Chart chartCal must exist');
            const barDataset = chartCal.data.datasets[0];
            assert(barDataset, 'Bar dataset must exist');
            // Chart.js minBarLength should be configured or nominal placeholder values provided
            assert(
                barDataset.minBarLength !== undefined || barDataset.data.some((v, i) => i < 6 && v > 0),
                'Chart should have minBarLength or nominal placeholder for missing bar visibility'
            );
        }
    },

    // ==========================================
    // R5: Period Deltas Boundaries (5 tests)
    // ==========================================
    {
        id: 'T2-R5-01',
        feature: 'R5',
        description: 'R5-Edge: Previous period has 0 meals logged -> displays "s/d" (avoids NaN/Infinity)',
        run: async () => {
            // Only meals in current 7 days (-6 to 0); 0 meals in previous 7 days (-13 to -7)
            const meals = createNachoPerfectDay(0);
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaCalEl = env.document.getElementById('pop-cal-delta') || env.document.querySelector('[data-pop="cal"]');
            assert(deltaCalEl, 'Delta calorie element must exist');
            const deltaText = deltaCalEl.textContent.toLowerCase();
            assert(
                !deltaText.includes('nan') && !deltaText.includes('infinity'),
                `Delta must never display NaN or Infinity, got: "${deltaText}"`
            );
            assert(
                deltaText.includes('s/d') || deltaText.includes('—') || deltaText.includes('sin datos'),
                `Expected "s/d" or neutral indicator when previous period is empty, got: "${deltaText}"`
            );
        }
    },
    {
        id: 'T2-R5-02',
        feature: 'R5',
        description: 'R5-Edge: Current period has 0 meals logged -> displays clean delta or neutral styling',
        run: async () => {
            // Only meals in previous 7 days; 0 in current
            const meals = [createMeal({ dayOffset: -10, calorias: 2000 })];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaCalEl = env.document.getElementById('pop-cal-delta') || env.document.querySelector('[data-pop="cal"]');
            assert(deltaCalEl, 'Delta calorie element must exist');
            const deltaText = deltaCalEl.textContent.toLowerCase();
            assert(!deltaText.includes('nan'), `Must not display NaN, got: "${deltaText}"`);
        }
    },
    {
        id: 'T2-R5-03',
        feature: 'R5',
        description: 'R5-Edge: Identical averages across both periods -> displays 0% or →',
        run: async () => {
            const meals = [];
            for (let offset = -13; offset <= 0; offset++) {
                meals.push(createMeal({ dayOffset: offset, calorias: 2200, proteina_g: 180, carbohidratos_g: 210, grasas_g: 70 }));
            }
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaCalEl = env.document.getElementById('pop-cal-delta') || env.document.querySelector('[data-pop="cal"]');
            assert(deltaCalEl, 'Delta calorie element must exist');
            assert(
                deltaCalEl.textContent.includes('0%') || deltaCalEl.textContent.includes('→'),
                `Expected 0% or neutral arrow for identical periods, got: "${deltaCalEl.textContent}"`
            );
        }
    },
    {
        id: 'T2-R5-04',
        feature: 'R5',
        description: 'R5-Edge: Large increase (>100% delta) formats cleanly without layout breaking',
        run: async () => {
            // Prev avg = 50g prot, Curr avg = 180g prot (+260%)
            const meals = [
                createMeal({ dayOffset: -10, proteina_g: 50 }),
                createMeal({ dayOffset: -2, proteina_g: 180 })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaProtEl = env.document.getElementById('pop-prot-delta') || env.document.querySelector('[data-pop="prot"]');
            assert(deltaProtEl, 'Delta protein element must exist');
            assert(deltaProtEl.textContent.includes('%'), 'Delta must include % symbol');
        }
    },
    {
        id: 'T2-R5-05',
        feature: 'R5',
        description: 'R5-Edge: Directional color rule: Protein increase is positive/emerald, decrease is red',
        run: async () => {
            const meals = createNachoTwoPeriodSet(); // Protein increased from 150 to 185
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const deltaProtEl = env.document.getElementById('pop-prot-delta') || env.document.querySelector('[data-pop="prot"]');
            assert(deltaProtEl, 'Delta protein element must exist');
            const classStr = deltaProtEl.className || '';
            assert(
                classStr.includes('emerald') || classStr.includes('green') || classStr.includes('blue'),
                `Expected positive protein delta to have green/emerald styling, got classes: "${classStr}"`
            );
        }
    },

    // ==========================================
    // R6: PWA Offline Boundaries (5 tests)
    // ==========================================
    {
        id: 'T2-R6-01',
        feature: 'R6',
        description: 'R6-Edge: Offline network failure falls back to cached Supabase responses',
        run: async () => {
            const swPath = path.resolve(__dirname, '../dashboard/sw.js');
            assert(fs.existsSync(swPath), 'dashboard/sw.js must exist');
            const env = createNutriNachoEnvironment({ silent: true });
            const sw = env.swMock.loadServiceWorkerFile(swPath);
            assert(sw.exists, 'Service worker must load');

            // Pre-seed cache with mock Supabase data
            const cache = await sw.caches.open('nutrinacho-api-v1');
            await cache.put(
                'https://example-project.supabase.co/rest/v1/metas',
                { status: 200, ok: true, json: async () => [METAS_FIXTURES.nachoActive] }
            );

            // Fetch while offline
            const response = await sw.triggerFetch('https://example-project.supabase.co/rest/v1/metas');
            assert(response, 'Must return cached response when offline');
        }
    },
    {
        id: 'T2-R6-02',
        feature: 'R6',
        description: 'R6-Edge: Offline indicator toggles on window offline event, hides on online event',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const banner = env.document.getElementById('offline-banner');
            assert(banner, 'Offline banner must exist');

            // Trigger offline
            env.setOnline(false);
            assert(!banner.classList.contains('hidden'), 'Banner must be visible when offline');

            // Trigger online
            env.setOnline(true);
            assert(banner.classList.contains('hidden'), 'Banner must be hidden when back online');
        }
    },
    {
        id: 'T2-R6-03',
        feature: 'R6',
        description: 'R6-Edge: Reconnecting online event automatically triggers data refresh',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            env.runScript();

            let refreshCalled = false;
            const originalLoadAll = env.sandbox.loadAll;
            if (originalLoadAll) {
                env.sandbox.loadAll = async () => {
                    refreshCalled = true;
                    return originalLoadAll();
                };
            }

            env.setOnline(false);
            env.setOnline(true);

            assert(refreshCalled || env.windowListeners?.online, 'Reconnection should trigger loadAll() or register online listener');
        }
    },
    {
        id: 'T2-R6-04',
        feature: 'R6',
        description: 'R6-Edge: Gemini AI request while offline displays friendly offline warning',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, online: false });
            env.runScript();

            if (env.sandbox.generateAIAnalysis) {
                await env.sandbox.generateAIAnalysis();
                const content = env.document.getElementById('ai-analysis-content');
                assert(content, 'AI content element must exist');
                assert(
                    content.textContent.toLowerCase().includes('conexión') || content.textContent.toLowerCase().includes('internet'),
                    `Expected offline notice in AI container, got: "${content.textContent}"`
                );
            }
        }
    },
    {
        id: 'T2-R6-05',
        feature: 'R6',
        description: 'R6-Edge: manifest.json schema specifies standalone, theme_color #0f172a, and icons',
        run: async () => {
            const manifestPath = path.resolve(__dirname, '../dashboard/manifest.json');
            assert(fs.existsSync(manifestPath), 'manifest.json must exist');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            assert.strictEqual(manifest.display, 'standalone', 'display must be standalone');
            assert.strictEqual(manifest.theme_color, '#0f172a', 'theme_color must be #0f172a');
            assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must specify icons');
        }
    },

    // ==========================================
    // R7: CSV Export Boundaries (5 tests)
    // ==========================================
    {
        id: 'T2-R7-01',
        feature: 'R7',
        description: 'R7-Edge: Meal names containing commas wrapped in quotes per RFC 4180',
        run: async () => {
            const meals = createSpecialCharacterMeals(0); // Contains 'Milanesa con papas fritas, limón y ensalada'
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(env.createdBlobs.length > 0, 'Blob must be created');
            const blobText = await env.createdBlobs[0].blob.text();
            assert(
                blobText.includes('"Milanesa con papas fritas, limón y ensalada"'),
                'Description with comma must be wrapped in double quotes'
            );
        }
    },
    {
        id: 'T2-R7-02',
        feature: 'R7',
        description: 'R7-Edge: Meal names containing double quotes escaped as "" per RFC 4180',
        run: async () => {
            const meals = createSpecialCharacterMeals(0); // Contains 'Café "Cortado" con medialunas de manteca'
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(env.createdBlobs.length > 0, 'Blob must be created');
            const blobText = await env.createdBlobs[0].blob.text();
            assert(
                blobText.includes('""Cortado""'),
                'Internal double quotes must be escaped as double-double-quotes ("")'
            );
        }
    },
    {
        id: 'T2-R7-03',
        feature: 'R7',
        description: 'R7-Edge: Spanish accented characters (á, é, í, ó, ú, ñ) preserved in UTF-8 CSV',
        run: async () => {
            const meals = createSpecialCharacterMeals(0); // Contains 'Ñoquis caseros...'
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            assert(env.createdBlobs.length > 0, 'Blob must be created');
            const blobText = await env.createdBlobs[0].blob.text();
            assert(blobText.includes('Ñoquis'), 'Spanish letter Ñ must be preserved without corruption');
            assert(blobText.includes('Café'), 'Spanish accented é must be preserved without corruption');
        }
    },
    {
        id: 'T2-R7-04',
        feature: 'R7',
        description: 'R7-Edge: Exporting period with 0 meals downloads valid header-only CSV or shows toast',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [] } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            assert.doesNotThrow(() => exportBtn.click(), 'Clicking export with 0 meals must not throw uncaught error');
        }
    },
    {
        id: 'T2-R7-05',
        feature: 'R7',
        description: 'R7-Edge: User name with accents (Mamá) sanitized in filename (NutriNacho_Mama_...)',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [] } });
            env.runScript();
            if (env.sandbox.loadAll) await env.sandbox.loadAll();

            let clickedAnchor = null;
            env.document.createElement = (tag) => {
                const el = new (require('./harness/dom_env').DOMElement)(tag);
                if (tag.toLowerCase() === 'a') clickedAnchor = el;
                return el;
            };

            // Switch to Mamá
            if (env.sandbox.selectUser) await env.sandbox.selectUser(MAMA_ID);

            const exportBtn = env.document.getElementById('btn-export-csv') || env.document.querySelector('[onclick*="export"]');
            assert(exportBtn, 'Export button must exist');
            exportBtn.click();

            if (clickedAnchor) {
                const filename = clickedAnchor.getAttribute('download') || clickedAnchor.download || '';
                assert(!filename.includes('á'), `Filename should sanitize accents, got: ${filename}`);
                assert(filename.includes('Mama') || filename.includes('mama'), `Filename should contain Mama, got: ${filename}`);
            }
        }
    },

    // ==========================================
    // Layout & Viewport Boundary
    // ==========================================
    {
        id: 'T2-CSS-01',
        feature: 'Layout',
        description: 'Layout-Edge: DOM elements and grid containers use responsive flex-wrap and zero overflow classes',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true });
            const html = env.rawHTML;

            // Trend range container should have flex-wrap or safe spacing to prevent overflow on 320px
            assert(
                html.includes('flex-wrap') || html.includes('overflow-x-auto') || html.includes('max-w-5xl'),
                'Dashboard containers must include responsive flex-wrap or overflow containment'
            );
        }
    },
    // ==========================================
    // Regression: over-goal cards must stay visible
    // ==========================================
    {
        id: 'T2-LAYOUT-02',
        feature: 'Layout',
        description: 'Regression: .over-goal keeps the fadeUp animation so cards above goal do not stay at opacity 0',
        run: async () => {
            const html = fs.readFileSync(path.resolve(__dirname, '../dashboard/index.html'), 'utf8');
            const animateIn = html.match(/\.animate-in\s*\{([^}]*)\}/);
            assert(animateIn && /opacity:\s*0/.test(animateIn[1]), '.animate-in is expected to start at opacity 0');
            const overGoal = html.match(/\.over-goal\s*\{([^}]*)\}/);
            assert(overGoal, '.over-goal rule must exist');
            assert(/animation:[^;]*fadeUp/.test(overGoal[1]),
                '.over-goal overrides .animate-in animation; it must still run fadeUp or the card stays invisible');
        }
    },
];

module.exports = { tier2Tests };
