#!/usr/bin/env node
// NutriNacho dashboard tests against dashboard/index.html & dashboard/sw.js.
// Usage: node tests/e2e_runner.js  (exit 1 if any test fails)

const suites = [
    ['Tier 1: Feature Coverage', require('./tier1_feature_coverage').tier1Tests],
    ['Tier 2: Boundary & Corner Cases', require('./tier2_boundary_corner').tier2Tests],
    ['Tier 3: Cross-Feature Combinations', require('./tier3_cross_feature').tier3Tests],
    ['Tier 4: Real-World Scenarios', require('./tier4_real_world').tier4Tests],
    ['Tier 5: Export & State Stress', require('./stress_m2_r7_state').stressR7Tests]
];

(async () => {
    let passed = 0, failed = 0;
    for (const [name, tests] of suites) {
        console.log(`\n▶ ${name} (${tests.length} tests)`);
        for (const t of tests) {
            try {
                await t.run();
                passed++;
                console.log(`  \x1b[32m✓ [${t.id}]\x1b[0m ${t.description}`);
            } catch (err) {
                failed++;
                console.log(`  \x1b[31m✗ [${t.id}]\x1b[0m ${t.description}\n    \x1b[33mReason:\x1b[0m ${err.message || err}`);
            }
        }
    }
    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
