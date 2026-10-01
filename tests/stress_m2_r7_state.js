/**
 * NutriNacho M2 Empirical Stress Test Harness: Feature R7 (CSV Export) & Multi-State Transitions
 * Author: challenger_m2_2
 */

const assert = require('assert');
const { createNutriNachoEnvironment } = require('./harness/dom_env');
const { NACHO_ID, MAMA_ID, METAS_FIXTURES } = require('./fixtures/metas_fixtures');
const { createMeal, getLogicalDateString } = require('./fixtures/comidas_fixtures');

// Strict RFC 4180 CSV Parser Oracle
function parseRFC4180(text) {
    let raw = text;
    // Strip UTF-8 BOM(s)
    while (raw.length > 0 && raw.charCodeAt(0) === 0xFEFF) {
        raw = raw.slice(1);
    }

    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < raw.length) {
        const char = raw[i];

        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < raw.length && raw[i + 1] === '"') {
                    currentField += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                currentField += char;
                i++;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
                i++;
            } else if (char === ',') {
                currentRow.push(currentField);
                currentField = '';
                i++;
            } else if (char === '\r') {
                if (i + 1 < raw.length && raw[i + 1] === '\n') {
                    i++;
                }
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                i++;
            } else if (char === '\n') {
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                i++;
            } else {
                currentField += char;
                i++;
            }
        }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    // Filter out trailing empty row if CSV ends with newline
    if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
        rows.pop();
    }

    return rows;
}

// Helper to trigger export and capture download anchor & blob
function captureCSVExport(env) {
    let clickedAnchor = null;
    const originalCreateElement = env.document.createElement.bind(env.document);
    env.document.createElement = (tag) => {
        const el = originalCreateElement(tag);
        if (tag.toLowerCase() === 'a') {
            clickedAnchor = el;
        }
        return el;
    };

    const exportBtn = env.document.getElementById('btn-export-csv');
    assert(exportBtn, '#btn-export-csv must exist in DOM');
    exportBtn.click();

    assert(clickedAnchor, 'Anchor tag must be dynamically created for download');
    const filename = clickedAnchor.getAttribute('download') || clickedAnchor.download;
    const blobRecord = env.createdBlobs[env.createdBlobs.length - 1];
    assert(blobRecord, 'A Blob must be created via URL.createObjectURL');

    return {
        anchor: clickedAnchor,
        filename,
        blob: blobRecord.blob
    };
}

const stressR7Tests = [
    // ------------------------------------------------------------------
    // Vector 1: RFC 4180 Escaping & Special Characters
    // ------------------------------------------------------------------
    {
        id: 'R7-STR-01',
        feature: 'R7',
        description: 'R7-Stress: Meal names with single and multiple commas are quoted properly',
        run: async () => {
            const meals = [
                createMeal({ dayOffset: 0, comida: 'Milanesa con papas, limón, mayonesa y ensalada' })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows.length, 2, 'Must have exactly 2 rows (header + 1 meal)');
            assert.strictEqual(rows[1][1], 'Milanesa con papas, limón, mayonesa y ensalada');
        }
    },
    {
        id: 'R7-STR-02',
        feature: 'R7',
        description: 'R7-Stress: Meal names with double quotes escaped as "" per RFC 4180',
        run: async () => {
            const meals = [
                createMeal({ dayOffset: 0, comida: 'Café "Cortado" con "Medialunas"' })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            assert(text.includes('""Cortado""') && text.includes('""Medialunas""'), 'Quotes must be escaped with double quotes');
            const rows = parseRFC4180(text);
            assert.strictEqual(rows[1][1], 'Café "Cortado" con "Medialunas"');
        }
    },
    {
        id: 'R7-STR-03',
        feature: 'R7',
        description: 'R7-Stress: Meal names containing literal newlines (LF and CRLF) preserved within quoted field',
        run: async () => {
            const multilineComida = 'Combo Saludable:\n- Pechuga de pollo\r\n- Arroz integral\n- Palta';
            const meals = [
                createMeal({ dayOffset: 0, comida: multilineComida })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows.length, 2, 'Strict parser must yield 2 records despite internal newlines');
            assert.strictEqual(rows[1][1], multilineComida, 'Parsed field must preserve exact multiline content');
        }
    },
    {
        id: 'R7-STR-04',
        feature: 'R7',
        description: 'R7-Stress: Full Spanish accented character set & punctuation: á, é, í, ó, ú, ü, ñ, ¿, ¡, €',
        run: async () => {
            const spanishComida = '¿¡Ñandú güisqui con piña, jamón, café & 100€ de postre!?';
            const meals = [
                createMeal({ dayOffset: 0, comida: spanishComida })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows[1][1], spanishComida, 'All Spanish accents and punctuation must be preserved intact');
        }
    },
    {
        id: 'R7-STR-05',
        feature: 'R7',
        description: 'R7-Stress: Complex hostile input (quotes, commas, newlines, accents, emojis) in single meal',
        run: async () => {
            const complex = '"Super-Mega" combo, con:\n1. 🍕 Pizza "Napolitana" (con ajo)\n2. 🥗 Ensalada ¡Ñoquis!\n3. 🍺 Cerveza "Quilmes", fría';
            const meals = [
                createMeal({ dayOffset: 0, comida: complex, calorias: 1250, proteina_g: 45, carbohidratos_g: 130, grasas_g: 35 })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows[1][1], complex);
            assert.strictEqual(rows[1][2], '1250');
            assert.strictEqual(rows[1][3], '45');
            assert.strictEqual(rows[1][4], '130');
            assert.strictEqual(rows[1][5], '35');
        }
    },
    {
        id: 'R7-STR-06',
        feature: 'R7',
        description: 'R7-Stress: Edge cases in meal fields: empty string, null description, string & zero macros',
        run: async () => {
            const m1 = createMeal({ dayOffset: 0, calorias: 0, proteina_g: 0, carbohidratos_g: 0, grasas_g: 0 });
            m1.comida = '';
            const m2 = createMeal({ dayOffset: -1, calorias: '750', proteina_g: 35.5, carbohidratos_g: null, grasas_g: 0 });
            m2.comida = null;
            const meals = [m1, m2];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows.length, 3, 'Must have 3 rows (header + 2 meals)');
            // Meal from day 0 (m1): empty comida defaults to 'Sin nombre'
            assert.strictEqual(rows[2][1], 'Sin nombre', 'Empty meal name defaults to "Sin nombre"');
            assert.strictEqual(rows[2][2], '0', 'Zero calories formatted as "0"');
            // Meal from day -1 (m2): null comida defaults to 'Sin nombre', string '750' to number
            assert.strictEqual(rows[1][1], 'Sin nombre', 'Null meal name defaults to "Sin nombre"');
            assert.strictEqual(rows[1][2], '750');
            assert.strictEqual(rows[1][3], '35.5');
            assert.strictEqual(rows[1][4], '0');
            assert.strictEqual(rows[1][5], '0');
        }
    },

    // ------------------------------------------------------------------
    // Vector 2: UTF-8 BOM, Header Columns & Line Endings
    // ------------------------------------------------------------------
    {
        id: 'R7-STR-07',
        feature: 'R7',
        description: 'R7-Stress: CSV content begins with UTF-8 BOM (0xFEFF)',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [createMeal({ dayOffset: 0 })] } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            assert.strictEqual(text.charCodeAt(0), 0xFEFF, 'First character must be UTF-8 BOM');
        }
    },
    {
        id: 'R7-STR-08',
        feature: 'R7',
        description: 'R7-Stress: Exact header row specification: Fecha,Comida,Calorías,Proteína (g),Carbohidratos (g),Grasas (g)',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [createMeal({ dayOffset: 0 })] } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            const header = rows[0];
            assert.deepStrictEqual(header, [
                'Fecha',
                'Comida',
                'Calorías',
                'Proteína (g)',
                'Carbohidratos (g)',
                'Grasas (g)'
            ], 'Header must match exact specification with 6 columns');
        }
    },
    {
        id: 'R7-STR-09',
        feature: 'R7',
        description: 'R7-Stress: Consistent CRLF (\\r\\n) line endings across header and records',
        run: async () => {
            const meals = [
                createMeal({ dayOffset: 0, comida: 'Comida 1' }),
                createMeal({ dayOffset: -1, comida: 'Comida 2' })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            assert(text.includes('\r\n'), 'CSV must use CRLF (\\r\\n) line breaks');
        }
    },

    // ------------------------------------------------------------------
    // Vector 3: Dataset Sizes & Date Range Confinement
    // ------------------------------------------------------------------
    {
        id: 'R7-STR-10',
        feature: 'R7',
        description: 'R7-Stress: Empty period (0 meals in DB) exports valid header-only CSV with BOM',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [] } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows.length, 1, 'Header-only CSV must have exactly 1 row');
            assert.strictEqual(rows[0][0], 'Fecha');
        }
    },
    {
        id: 'R7-STR-11',
        feature: 'R7',
        description: 'R7-Stress: Single meal in active range exports exactly 1 data row',
        run: async () => {
            const meal = createMeal({ dayOffset: -3, comida: 'Almuerzo solitario', calorias: 500, proteina_g: 40, carbohidratos_g: 50, grasas_g: 15 });
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [meal] } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows.length, 2, 'Header + 1 data row');
            assert.strictEqual(rows[1][1], 'Almuerzo solitario');
            assert.strictEqual(rows[1][2], '500');
        }
    },
    {
        id: 'R7-STR-12',
        feature: 'R7',
        description: 'R7-Stress: Dense 30-day dataset (120 meals) exports all 120 meals in chronological order',
        run: async () => {
            const meals = [];
            for (let offset = -29; offset <= 0; offset++) {
                for (let m = 0; m < 4; m++) {
                    meals.push(createMeal({
                        dayOffset: offset,
                        comida: `Día ${offset} Comida ${m + 1}`,
                        calorias: 500,
                        proteina_g: 40,
                        carbohidratos_g: 50,
                        grasas_g: 15
                    }));
                }
            }
            assert.strictEqual(meals.length, 120);

            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.setRange(30);

            const { blob } = captureCSVExport(env);
            const text = await blob.text();
            const rows = parseRFC4180(text);

            assert.strictEqual(rows.length, 121, `Expected 121 rows (1 header + 120 meals), got ${rows.length}`);
            assert(rows[1][1].includes('Día -29'), `First row must be from day -29, got ${rows[1][1]}`);
            assert(rows[120][1].includes('Día 0'), `Last row must be from day 0, got ${rows[120][1]}`);
        }
    },
    {
        id: 'R7-STR-13',
        feature: 'R7',
        description: 'R7-Stress: Strict date confinement: 7d range excludes meals from day -8, 14d includes them',
        run: async () => {
            const meals = [
                createMeal({ dayOffset: -2, comida: 'Comida en rango 7d' }),
                createMeal({ dayOffset: -8, comida: 'Comida fuera de 7d pero en 14d' }),
                createMeal({ dayOffset: -20, comida: 'Comida fuera de 14d pero en 30d' })
            ];

            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();

            // 1. Export in 7d range
            await env.sandbox.setRange(7);
            const export7 = captureCSVExport(env);
            const rows7 = parseRFC4180(await export7.blob.text());
            assert.strictEqual(rows7.length, 2, '7d export must contain only 1 meal');
            assert.strictEqual(rows7[1][1], 'Comida en rango 7d');

            // 2. Export in 14d range
            await env.sandbox.setRange(14);
            const export14 = captureCSVExport(env);
            const rows14 = parseRFC4180(await export14.blob.text());
            assert.strictEqual(rows14.length, 3, '14d export must contain exactly 2 meals');
            assert.strictEqual(rows14[1][1], 'Comida fuera de 7d pero en 14d');
            assert.strictEqual(rows14[2][1], 'Comida en rango 7d');

            // 3. Export in 30d range
            await env.sandbox.setRange(30);
            const export30 = captureCSVExport(env);
            const rows30 = parseRFC4180(await export30.blob.text());
            assert.strictEqual(rows30.length, 4, '30d export must contain all 3 meals');
        }
    },
    {
        id: 'R7-STR-14',
        feature: 'R7',
        description: 'R7-Stress: Sparse dataset with unlogged days exports ZERO phantom rows',
        run: async () => {
            const meals = [
                createMeal({ dayOffset: -6, comida: 'Desayuno Día -6' }),
                createMeal({ dayOffset: -3, comida: 'Almuerzo Día -3' }),
                createMeal({ dayOffset: 0, comida: 'Cena Día 0' })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const rows = parseRFC4180(await blob.text());

            assert.strictEqual(rows.length, 4, `Expected 4 rows, got ${rows.length}. No phantom rows allowed.`);
        }
    },

    // ------------------------------------------------------------------
    // Vector 4: Filename Sanitization & Formatting
    // ------------------------------------------------------------------
    {
        id: 'R7-STR-15',
        feature: 'R7',
        description: 'R7-Stress: Nacho filename format: NutriNacho_Nacho_7d_DD-MM-YYYY.csv',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [] } });
            env.runScript();
            await env.sandbox.loadAll();

            const { filename } = captureCSVExport(env);
            const todayStr = getLogicalDateString(0);
            const [y, m, d] = todayStr.split('-');
            const expected = `NutriNacho_Nacho_7d_${d}-${m}-${y}.csv`;

            assert.strictEqual(filename, expected, `Filename must be ${expected}, got ${filename}`);
        }
    },
    {
        id: 'R7-STR-16',
        feature: 'R7',
        description: 'R7-Stress: Mamá filename strips accent cleanly: NutriNacho_Mama_... without "á"',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { metas: [METAS_FIXTURES.mamaActive], comidas: [] } });
            env.runScript();
            await env.sandbox.selectUser(MAMA_ID);

            const { filename } = captureCSVExport(env);
            assert(filename.startsWith('NutriNacho_Mama_'), `Filename must start with NutriNacho_Mama_, got ${filename}`);
            assert(!filename.includes('á'), 'Filename must NOT contain accented character "á"');
        }
    },
    {
        id: 'R7-STR-17',
        feature: 'R7',
        description: 'R7-Stress: Range changes dynamically reflect in filename (14d and 30d)',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [] } });
            env.runScript();
            await env.sandbox.loadAll();

            await env.sandbox.setRange(14);
            const res14 = captureCSVExport(env);
            assert(res14.filename.includes('_14d_'), `Filename must reflect 14d: ${res14.filename}`);

            await env.sandbox.setRange(30);
            const res30 = captureCSVExport(env);
            assert(res30.filename.includes('_30d_'), `Filename must reflect 30d: ${res30.filename}`);
        }
    },

    // ------------------------------------------------------------------
    // Vector 5: Multi-State Switching, Race Conditions & Isolation
    // ------------------------------------------------------------------
    {
        id: 'R7-STR-18',
        feature: 'R7',
        description: 'R7-Stress: Rapid sequential range switching (7 -> 14 -> 30 -> 7) maintains state integrity',
        run: async () => {
            const meals = [
                createMeal({ dayOffset: -1, comida: 'M1' }),
                createMeal({ dayOffset: -10, comida: 'M2' }),
                createMeal({ dayOffset: -25, comida: 'M3' })
            ];
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: meals } });
            env.runScript();

            await env.sandbox.setRange(7);
            await env.sandbox.setRange(14);
            await env.sandbox.setRange(30);
            await env.sandbox.setRange(7);

            assert.strictEqual(env.eval('currentRange'), 7, 'currentRange must be 7');
            const { filename, blob } = captureCSVExport(env);
            assert(filename.includes('_7d_'), 'Filename must reflect final range 7d');
            const rows = parseRFC4180(await blob.text());
            assert.strictEqual(rows.length, 2, 'Only meals within 7d must be exported');
            assert.strictEqual(rows[1][1], 'M1');
        }
    },
    {
        id: 'R7-STR-19',
        feature: 'R7',
        description: 'R7-Stress: Rapid user switching (Nacho -> Mamá -> Nacho) maintains correct user identity and meals',
        run: async () => {
            const meals = [
                createMeal({ usuario_id: NACHO_ID, dayOffset: 0, comida: 'Bife de Nacho' }),
                createMeal({ usuario_id: MAMA_ID, dayOffset: 0, comida: 'Ensalada de Mamá' })
            ];

            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                    comidas: meals
                }
            });
            env.runScript();

            // 1. Initial Nacho
            await env.sandbox.loadAll();
            const exportNacho1 = captureCSVExport(env);
            assert(exportNacho1.filename.includes('Nacho'));
            const rowsNacho1 = parseRFC4180(await exportNacho1.blob.text());
            assert.strictEqual(rowsNacho1[1][1], 'Bife de Nacho');

            // 2. Switch to Mamá
            await env.sandbox.selectUser(MAMA_ID);
            const exportMama = captureCSVExport(env);
            assert(exportMama.filename.includes('Mama'));
            const rowsMama = parseRFC4180(await exportMama.blob.text());
            assert.strictEqual(rowsMama[1][1], 'Ensalada de Mamá');

            // 3. Switch back to Nacho
            await env.sandbox.selectUser(NACHO_ID);
            const exportNacho2 = captureCSVExport(env);
            assert(exportNacho2.filename.includes('Nacho'));
            const rowsNacho2 = parseRFC4180(await exportNacho2.blob.text());
            assert.strictEqual(rowsNacho2[1][1], 'Bife de Nacho');
        }
    },
    {
        id: 'R7-STR-20',
        feature: 'R7',
        description: 'R7-Stress: Cross-user data isolation: Mamá with 0 meals must NOT leak Nacho meals into Mamá CSV',
        run: async () => {
            // Nacho has meals, but Mamá has ZERO meals
            const meals = [
                createMeal({ usuario_id: NACHO_ID, dayOffset: 0, comida: 'Desayuno de Nacho' }),
                createMeal({ usuario_id: NACHO_ID, dayOffset: -1, comida: 'Almuerzo de Nacho' })
            ];

            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                    comidas: meals
                }
            });
            env.runScript();
            await env.sandbox.loadAll();

            // Switch to Mamá
            await env.sandbox.selectUser(MAMA_ID);

            // Export Mamá's CSV
            const exportMama = captureCSVExport(env);
            assert(exportMama.filename.includes('Mama'), `Filename must be for Mama: ${exportMama.filename}`);

            const rows = parseRFC4180(await exportMama.blob.text());

            // CRITICAL CHECK: Mamá has 0 meals. Mamá's CSV MUST be header-only (length 1).
            // If fetchComidas fallback leaked Nacho's meals to Mamá, rows.length will be > 1!
            assert.strictEqual(
                rows.length,
                1,
                `DATA LEAKAGE DETECTED: Mamá has 0 meals logged, but export contained ${rows.length - 1} meals from Nacho! (${rows.slice(1).map(r => r[1]).join(', ')})`
            );
        }
    },
    {
        id: 'R7-STR-21',
        feature: 'R7',
        description: 'R7-Stress: Concurrent in-flight race condition: rapid selectUser calls discard stale responses',
        run: async () => {
            const meals = [
                createMeal({ usuario_id: NACHO_ID, dayOffset: 0, comida: 'Nacho In-Flight' }),
                createMeal({ usuario_id: MAMA_ID, dayOffset: 0, comida: 'Mama In-Flight' })
            ];

            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                    comidas: meals
                }
            });
            env.runScript();

            const p1 = env.sandbox.selectUser(MAMA_ID);
            const p2 = env.sandbox.selectUser(NACHO_ID);
            await Promise.all([p1, p2]);

            assert.strictEqual(env.eval('currentUser'), NACHO_ID);
            const { filename, blob } = captureCSVExport(env);
            assert(filename.includes('Nacho'));
            const rows = parseRFC4180(await blob.text());
            assert.strictEqual(rows[1][1], 'Nacho In-Flight');
        }
    },
    {
        id: 'R7-STR-22',
        feature: 'R7',
        description: 'R7-Stress: UI Trigger: clicking #btn-export-csv invokes exportPeriodCSV directly',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [createMeal({ dayOffset: 0 })] } });
            env.runScript();
            await env.sandbox.loadAll();

            const initialBlobs = env.createdBlobs.length;
            const btn = env.document.getElementById('btn-export-csv');
            assert(btn, '#btn-export-csv must exist in DOM');
            btn.click();

            assert.strictEqual(env.createdBlobs.length, initialBlobs + 1, 'Clicking button must generate exactly ONE download blob');
        }
    },
    {
        id: 'R7-STR-23',
        feature: 'R7',
        description: 'R7-Stress: Double BOM check: CSV file must not contain duplicate BOM bytes (0xEF 0xBB 0xBF 0xEF 0xBB 0xBF)',
        run: async () => {
            const env = createNutriNachoEnvironment({ silent: true, supabase: { comidas: [createMeal({ dayOffset: 0 })] } });
            env.runScript();
            await env.sandbox.loadAll();

            const { blob } = captureCSVExport(env);
            const arrayBuf = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuf);
            
            // Check if bytes 0..2 AND bytes 3..5 are both UTF-8 BOM [0xEF, 0xBB, 0xBF]
            const isFirstBOM = (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF);
            const isSecondBOM = (bytes[3] === 0xEF && bytes[4] === 0xBB && bytes[5] === 0xBF);
            
            assert(
                !(isFirstBOM && isSecondBOM),
                'DOUBLE BOM BYTES DETECTED: File raw bytes begin with [0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF]. Standard UTF-8 tools will decode the second 3-byte sequence as literal character \\uFEFF, resulting in column name "\\uFEFFFecha".'
            );
        }
    },
    {
        id: 'R7-STR-24',
        feature: 'R7',
        description: 'R7-Stress: In-flight user switch: export during pending loadAll must not export stale user data under new user name',
        run: async () => {
            const meals = [
                createMeal({ usuario_id: NACHO_ID, dayOffset: 0, comida: 'Bife de Nacho' }),
                createMeal({ usuario_id: MAMA_ID, dayOffset: 0, comida: 'Ensalada de Mamá' })
            ];
            const env = createNutriNachoEnvironment({
                silent: true,
                supabase: {
                    metas: [METAS_FIXTURES.nachoActive, METAS_FIXTURES.mamaActive],
                    comidas: meals
                }
            });
            env.runScript();
            await env.sandbox.loadAll();

            // Trigger selectUser(MAMA_ID) but do NOT await it immediately
            const p = env.sandbox.selectUser(MAMA_ID);
            
            // Attempt export while switch is in-flight
            const { filename, blob } = captureCSVExport(env);
            const rows = parseRFC4180(await blob.text());

            // If filename says Mama, but rows contain Nacho's meal, there is an in-flight state desynchronization
            if (filename.includes('Mama') && rows.length > 1 && rows[1][1].includes('Nacho')) {
                assert.fail('RACE CONDITION: exportPeriodCSV() called during in-flight user switch exported Nacho meals into Mama CSV file!');
            }
            await p;
        }
    }
];

module.exports = {
    stressR7Tests,
    parseRFC4180
};

if (require.main === module) {
    (async () => {
        console.log('Running ' + stressR7Tests.length + ' stress tests in tests/stress_m2_r7_state.js...\n');
        let passed = 0;
        let failed = 0;
        for (const t of stressR7Tests) {
            try {
                await t.run();
                console.log(`  ✓ [${t.id}] ${t.description}`);
                passed++;
            } catch (err) {
                console.error(`  ✗ [${t.id}] ${t.description}\n    ${err.stack || err.message}`);
                failed++;
            }
        }
        console.log(`\n======================================================================`);
        console.log(`Results: ${passed} passed, ${failed} failed out of ${stressR7Tests.length} tests`);
        console.log(`======================================================================`);
        if (failed > 0) process.exit(1);
    })();
}
