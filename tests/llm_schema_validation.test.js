const assert = require('node:assert/strict');
const { validateAgainstSchema } = require('../server/llm/validateSchema');
const { featuresSchema, summarySchema } = require('../server/llm/schemas');

function testFeaturesPass() {
  const sample = {
    core_features: [
      { action: 'a1', mechanism: 'm1', benefit: 'b1', proof: 'p1' },
      { action: 'a2', mechanism: 'm2', benefit: 'b2', proof: 'p2' },
      { action: 'a3', mechanism: 'm3', benefit: 'b3', proof: 'p3' }
    ],
    dependencies: ['dep1', 'dep2'],
    risks: ['r1', 'r2']
  };
  assert.equal(validateAgainstSchema(sample, featuresSchema), true);
}

function testFeaturesFailMissingField() {
  const sample = {
    core_features: [
      { action: 'a1', mechanism: 'm1', benefit: 'b1' },
      { action: 'a2', mechanism: 'm2', benefit: 'b2', proof: 'p2' },
      { action: 'a3', mechanism: 'm3', benefit: 'b3', proof: 'p3' }
    ],
    dependencies: ['dep1', 'dep2'],
    risks: ['r1', 'r2']
  };
  assert.throws(() => validateAgainstSchema(sample, featuresSchema));
}

function testSummaryPass() {
  const sample = {
    story_30s: 's30',
    story_2min: 's2',
    vp_one_liner: 'vp',
    drivers: ['d1', 'd2', 'd3'],
    objections: ['o1', 'o2'],
    parameter_card: {
      target_segment: 'ToC_DIFF_ADULT',
      arch_tag: 'Experience',
      channel_mix: 'Direct 50 / Ecommerce 50',
      target_gm: '0.52',
      key_metric: 'retention'
    },
    weakest_link: 'wl',
    one_missing_evidence: 'me'
  };
  assert.equal(validateAgainstSchema(sample, summarySchema), true);
}

function main() {
  testFeaturesPass();
  testFeaturesFailMissingField();
  testSummaryPass();
  console.log('llm_schema_validation.test.js: all tests passed');
}

main();
