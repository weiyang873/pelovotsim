const LOVOT_CELL = { customerType: "B2C", strategy: "差异化", valueProp: "体验" };

const subscriptionTiers = {
  lite: { label: "Lite(低价)", arpu: 39, penetration: 0.2, retention: 0.9, contentCost: 9, serviceCost: 4 },
  plus: { label: "Plus(标准)", arpu: 79, penetration: 0.32, retention: 0.92, contentCost: 20, serviceCost: 6 },
  pro: { label: "Pro(高价值)", arpu: 129, penetration: 0.42, retention: 0.94, contentCost: 38, serviceCost: 10 }
};

const complianceTiers = {
  basic: { label: "基础", trustBoost: 0, riskCut: 0, fixedCost: 0 },
  enhanced: { label: "增强", trustBoost: 0.03, riskCut: 0.12, fixedCost: 30000 },
  strong: { label: "强合规", trustBoost: 0.06, riskCut: 0.22, fixedCost: 65000 }
};
