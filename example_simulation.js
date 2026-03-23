const path = require("node:path");
const { loadConfig, simulate } = require("./engine");

const configDir = path.join(__dirname, "game_config_v0.1");
const config = loadConfig(configDir);

const teamState = {
  cell_macro_x: "B2C|差异化|体验",
  round1: {
    value_weights: {
      emotion: 0.30,
      intelligence: 0.20,
      privacy: 0.15,
      fun: 0.20,
      value_for_money: 0.10,
      function: 0.05
    }
  },
  round2: {
    selected_cards: ["f2", "f6", "f9", "f10", "f11", "f12"],
    channels: ["ECOM", "DIRECT"],
    target_gm: 0.42,
    compliance_tier: "MID",
    content_tier: "MID",
    sub_price_tier: "MID"
  }
};

const result = simulate(teamState, config);
console.log(JSON.stringify(result, null, 2));
