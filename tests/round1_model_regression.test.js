const assert = require('node:assert/strict');
const Engine = require('../engine');

const knowledge = {
  ToC_DIFF_ADULT: {
    wtp_median_price: 8999,
    price_elasticity: 1.2,
    crowding: 'HIGH'
  }
};

const baseParams = {
  A_min: 0.2,
  sigmoid_a: 5.0,
  beta_arch: 0.2,
  GM_cap: 0.65,
  fee_direct: 0.1,
  fee_distributor: 0.28,
  fee_ecommerce: 0.16,
  COGS_base_ToC: 2200,
  COGS_base_ToB: 3500,
  m_age: { ELDER: 1.1, ADULT: 1.0, CHILD: 0.95 },
  m_arch: { Experience: 1.05, Hybrid: 1.0, Function: 0.95 },
  Fit_age: {
    Experience: { ELDER: 0.9, ADULT: 0.8, CHILD: 0.7 },
    Hybrid: { ELDER: 0.8, ADULT: 0.8, CHILD: 0.8 },
    Function: { ELDER: 0.75, ADULT: 0.8, CHILD: 0.85 }
  },
  Fit_strategy: {
    Experience: { DIFF: 0.9, COST: 0.6 },
    Hybrid: { DIFF: 0.8, COST: 0.75 },
    Function: { DIFF: 0.7, COST: 0.9 }
  },
  Fit_customer: {
    Experience: { ToC: 0.9, ToB: 0.7 },
    Hybrid: { ToC: 0.8, ToB: 0.8 },
    Function: { ToC: 0.7, ToB: 0.9 }
  },
  w_age: 0.45,
  w_str: 0.35,
  w_cust: 0.2
};

function run(input, params = baseParams) {
  return Engine.computeRound1GM(
    {
      round1: {
        customer_type: 'ToC',
        strategy: 'DIFF',
        age_group: 'ADULT',
        arch_tag: 'Experience',
        fit_text: 1.0,
        ...input
      }
    },
    knowledge,
    params
  );
}

function testDistributorShareIncreasesFeeAndLowersGM() {
  const lowDist = run({
    channels: [
      { name: 'Direct', share: 0.8 },
      { name: 'Distributor', share: 0.2 }
    ]
  });
  const highDist = run({
    channels: [
      { name: 'Direct', share: 0.2 },
      { name: 'Distributor', share: 0.8 }
    ]
  });

  assert.ok(highDist.f > lowDist.f, 'Distributor share up should raise channel fee');
  assert.ok(highDist.GM_final < lowDist.GM_final, 'Distributor share up should lower GM_final');
}

function testAminIncreasesLowerPmaxAndGM() {
  const lowA = run(
    {
      channels: [
        { name: 'Direct', share: 0.5 },
        { name: 'Ecommerce', share: 0.5 }
      ]
    },
    { ...baseParams, A_min: 0.1, GM_cap: 0.95 }
  );
  const highA = run(
    {
      channels: [
        { name: 'Direct', share: 0.5 },
        { name: 'Ecommerce', share: 0.5 }
      ]
    },
    { ...baseParams, A_min: 0.3, GM_cap: 0.95 }
  );

  assert.ok(highA.P_max < lowA.P_max, 'A_min up should lower P_max');
  assert.ok(highA.GM_final < lowA.GM_final, 'A_min up should lower GM_final');
}

function testFitTextOnlyAffectsGMFinal() {
  const fitLow = run({
    channels: [
      { name: 'Direct', share: 0.5 },
      { name: 'Ecommerce', share: 0.5 }
    ],
    fit_text: 0.95
  });
  const fitHigh = run({
    channels: [
      { name: 'Direct', share: 0.5 },
      { name: 'Ecommerce', share: 0.5 }
    ],
    fit_text: 1.05
  });

  assert.equal(fitLow.P_max, fitHigh.P_max, 'fit_text must not change P_max');
  assert.ok(fitHigh.GM_final > fitLow.GM_final, 'higher fit_text should raise GM_final when GM_max>0');
}

function main() {
  testDistributorShareIncreasesFeeAndLowersGM();
  testAminIncreasesLowerPmaxAndGM();
  testFitTextOnlyAffectsGMFinal();
  console.log('round1_model_regression.test.js: all 3 tests passed');
}

main();
