#!/usr/bin/env node

/**
 * NutriNacho Dashboard — Automated E2E Test Runner
 * Executes the 4-tier opaque-box test suite against dashboard/index.html & dashboard/sw.js
 *
 * Usage:
 *   node tests/e2e_runner.js                  # Run all tests (exit 0 on pass, 1 on fail)
 *   node tests/e2e_runner.js --baseline       # Baseline mode (reports baseline results, exit 0)
 *   node tests/e2e_runner.js --tier=1         # Filter by tier (1, 2, 3, 4)
 *   node tests/e2e_runner.js --feature=R1     # Filter by feature (R1..R7)
 *   node tests/e2e_runner.js --json           # Output machine-readable JSON
 */

const { tier1Tests } = require('./tier1_feature_coverage');
const { tier2Tests } = require('./tier2_boundary_corner');
const { tier3Tests } = require('./tier3_cross_feature');
const { tier4Tests } = require('./tier4_real_world');
let stressM2Tests = [];
try {
    const { stressR7Tests } = require('./stress_m2_r7_state');
    if (stressR7Tests) stressM2Tests = stressR7Tests;
} catch (e) {}

// Parse CLI flags
const args = process.argv.slice(2);
const isBaseline = args.includes('--baseline') || args.includes('--allow-fail');
const isJson = args.includes('--json');
const tierArg = args.find(a => a.startsWith('--tier='));
const featureArg = args.find(a => a.startsWith('--feature='));

const selectedTier = tierArg ? parseInt(tierArg.split('=')[1], 10) : null;
const selectedFeature = featureArg ? featureArg.split('=')[1].toUpperCase() : null;

// Assemble test suite
const allSuites = [
    { tier: 1, name: 'Tier 1: Feature Coverage (R1–R7)', tests: tier1Tests },
    { tier: 2, name: 'Tier 2: Boundary & Corner Cases', tests: tier2Tests },
    { tier: 3, name: 'Tier 3: Cross-Feature Combinations', tests: tier3Tests },
    { tier: 4, name: 'Tier 4: Real-World Scenarios', tests: tier4Tests },
    { tier: 5, name: 'Tier 5: Stress & Empirical Challenges (R7 & Multi-State)', tests: stressM2Tests }
];

async function runRunner() {
    const startTime = Date.now();
    const results = [];
    let passedCount = 0;
    let failedCount = 0;

    if (!isJson) {
        console.log('\n======================================================================');
        console.log('       NutriNacho Dashboard — 4-Tier Automated E2E Test Suite');
        console.log('======================================================================');
        if (isBaseline) {
            console.log(' Mode: BASELINE CHARACTERIZATION (exits 0, documents current state)');
        }
        if (selectedTier) console.log(` Filter: Tier ${selectedTier} only`);
        if (selectedFeature) console.log(` Filter: Feature ${selectedFeature} only`);
        console.log('----------------------------------------------------------------------\n');
    }

    for (const suite of allSuites) {
        if (selectedTier && suite.tier !== selectedTier) continue;

        let filteredTests = suite.tests;
        if (selectedFeature) {
            filteredTests = filteredTests.filter(t => (t.feature || '').toUpperCase().includes(selectedFeature));
        }

        if (filteredTests.length === 0) continue;

        if (!isJson) {
            console.log(`\n▶ [Tier ${suite.tier}] ${suite.name} (${filteredTests.length} tests)`);
            console.log('─'.repeat(70));
        }

        for (const test of filteredTests) {
            const testStart = Date.now();
            let status = 'PASS';
            let errorMsg = null;

            try {
                await test.run();
                passedCount++;
            } catch (err) {
                status = 'FAIL';
                failedCount++;
                errorMsg = err.message || String(err);
            }

            const duration = Date.now() - testStart;
            results.push({
                tier: suite.tier,
                id: test.id,
                feature: test.feature,
                description: test.description,
                status,
                duration,
                error: errorMsg
            });

            if (!isJson) {
                const mark = status === 'PASS' ? '✓' : '✗';
                const color = status === 'PASS' ? '\x1b[32m' : '\x1b[31m';
                const reset = '\x1b[0m';
                console.log(`  ${color}${mark} [${test.id}]${reset} ${test.description} (${duration}ms)`);
                if (status === 'FAIL') {
                    console.log(`    \x1b[33mReason:\x1b[0m ${errorMsg}`);
                }
            }
        }
    }

    const totalDuration = Date.now() - startTime;
    const totalExecuted = passedCount + failedCount;

    // Feature breakdown stats
    const featureStats = {};
    results.forEach(r => {
        const feat = r.feature || 'Other';
        if (!featureStats[feat]) featureStats[feat] = { total: 0, pass: 0, fail: 0 };
        featureStats[feat].total++;
        if (r.status === 'PASS') featureStats[feat].pass++;
        else featureStats[feat].fail++;
    });

    if (isJson) {
        console.log(JSON.stringify({
            summary: {
                total: totalExecuted,
                passed: passedCount,
                failed: failedCount,
                passRate: totalExecuted > 0 ? ((passedCount / totalExecuted) * 100).toFixed(1) + '%' : '0%',
                durationMs: totalDuration,
                mode: isBaseline ? 'baseline' : 'enforce'
            },
            featureStats,
            tests: results
        }, null, 2));
    } else {
        console.log('\n======================================================================');
        console.log('                         EXECUTION SUMMARY');
        console.log('======================================================================');
        console.log(` Total Tests Executed : ${totalExecuted}`);
        console.log(` Passed               : \x1b[32m${passedCount}\x1b[0m`);
        console.log(` Failed               : \x1b[31m${failedCount}\x1b[0m`);
        console.log(` Pass Rate            : ${totalExecuted > 0 ? ((passedCount / totalExecuted) * 100).toFixed(1) : 0}%`);
        console.log(` Total Time           : ${totalDuration}ms`);
        console.log('----------------------------------------------------------------------');
        console.log(' Feature Breakdown:');
        Object.entries(featureStats).forEach(([feat, stat]) => {
            const passPct = ((stat.pass / stat.total) * 100).toFixed(0);
            console.log(`   - ${feat.padEnd(16)} : ${stat.pass}/${stat.total} passed (${passPct}%)`);
        });
        console.log('======================================================================\n');
    }

    if (isBaseline) {
        process.exit(0);
    } else {
        process.exit(failedCount === 0 ? 0 : 1);
    }
}

runRunner().catch(err => {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
});
