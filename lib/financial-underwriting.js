export const UNDERWRITING_VERSION = 'max_doors_20k_v2_sales_cost_3pct';

export const DEFAULT_UNDERWRITING_ASSUMPTIONS = Object.freeze({
  purchaseCostRate: 0.12,
  costPerNewUnitEur: 20000,
  sellingCostRate: 0.03,
});

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

function sumUnitValues(units, keys) {
  if (!Array.isArray(units) || units.length === 0) return null;
  const values = units.map((unit) => firstNumber(...keys.map((key) => unit?.[key])));
  return values.every((value) => value !== null)
    ? values.reduce((total, value) => total + value, 0)
    : null;
}

function roundMoney(value) {
  return value === null ? null : Math.round(value);
}

function roundPercent(value) {
  return value === null ? null : Number(value.toFixed(2));
}

export function calculateUnderwriting(input = {}, assumptions = {}) {
  const purchaseCostRate = firstNumber(
    input.purchaseCostRate,
    assumptions.purchaseCostRate,
    DEFAULT_UNDERWRITING_ASSUMPTIONS.purchaseCostRate,
  );
  const costPerNewUnitEur = firstNumber(
    input.costPerNewUnitEur,
    assumptions.costPerNewUnitEur,
    DEFAULT_UNDERWRITING_ASSUMPTIONS.costPerNewUnitEur,
  );
  const sellingCostRate = firstNumber(
    input.sellingCostRate,
    assumptions.sellingCostRate,
    DEFAULT_UNDERWRITING_ASSUMPTIONS.sellingCostRate,
  );
  const purchasePriceEur = firstNumber(input.purchasePriceEur);
  const newUnitsCreated = firstNumber(input.newUnitsCreated);
  const purchaseCostsEur = firstNumber(
    input.purchaseCostsEur,
    purchasePriceEur !== null && purchaseCostRate !== null
      ? roundMoney(purchasePriceEur * purchaseCostRate)
      : null,
  );
  const transformationCostEur = firstNumber(
    input.transformationCostEur,
    newUnitsCreated !== null && costPerNewUnitEur !== null
      ? roundMoney(newUnitsCreated * costPerNewUnitEur)
      : null,
  );
  const calculatedProjectCost = [purchasePriceEur, purchaseCostsEur, transformationCostEur]
    .every((value) => value !== null)
    ? purchasePriceEur + purchaseCostsEur + transformationCostEur
    : null;
  const projectCostEur = firstNumber(input.projectCostEur, calculatedProjectCost);

  const unitPlan = Array.isArray(input.finalUnitPlan) ? input.finalUnitPlan : [];
  const explicitExits = input.exitValues || {};
  const spreadValues = input.spreadValues || {};
  const exits = {
    low: firstNumber(
      explicitExits.low,
      sumUnitValues(unitPlan, ['sale_value_low_eur', 'low_value_eur']),
      projectCostEur !== null && numberOrNull(spreadValues.low) !== null
        ? projectCostEur + numberOrNull(spreadValues.low)
        : null,
    ),
    base: firstNumber(
      explicitExits.base,
      sumUnitValues(unitPlan, ['sale_value_base_eur', 'base_value_eur']),
      projectCostEur !== null && numberOrNull(spreadValues.base) !== null
        ? projectCostEur + numberOrNull(spreadValues.base)
        : null,
    ),
    high: firstNumber(
      explicitExits.high,
      sumUnitValues(unitPlan, ['sale_value_high_eur', 'high_value_eur']),
      projectCostEur !== null && numberOrNull(spreadValues.high) !== null
        ? projectCostEur + numberOrNull(spreadValues.high)
        : null,
    ),
  };

  const scenario = (exitValueEur) => {
    if (exitValueEur === null || projectCostEur === null || projectCostEur <= 0) {
      return {
        exitValueEur,
        sellingCostEur: null,
        totalCostEur: null,
        profitLossEur: null,
        roiPct: null,
        marginOnSalesPct: null,
      };
    }
    const sellingCostEur = roundMoney(exitValueEur * sellingCostRate);
    const totalCostEur = roundMoney(projectCostEur + sellingCostEur);
    const profitLossEur = roundMoney(exitValueEur - totalCostEur);
    return {
      exitValueEur: roundMoney(exitValueEur),
      sellingCostEur,
      totalCostEur,
      profitLossEur,
      roiPct: roundPercent((profitLossEur / totalCostEur) * 100),
      marginOnSalesPct: exitValueEur > 0
        ? roundPercent((profitLossEur / exitValueEur) * 100)
        : null,
    };
  };

  const scenarios = {
    low: scenario(exits.low),
    base: scenario(exits.base),
    high: scenario(exits.high),
  };
  const hasValuation = Object.values(scenarios).some((value) => value.exitValueEur !== null);

  return {
    version: UNDERWRITING_VERSION,
    status: projectCostEur === null ? 'missing_project_cost' : hasValuation ? 'complete' : 'missing_exit_valuation',
    assumptions: { purchaseCostRate, costPerNewUnitEur, sellingCostRate },
    costs: {
      purchasePriceEur: roundMoney(purchasePriceEur),
      purchaseCostsEur: roundMoney(purchaseCostsEur),
      transformationCostEur: roundMoney(transformationCostEur),
      projectCostEur: roundMoney(projectCostEur),
      newUnitsCreated,
    },
    scenarios,
    formulas: {
      purchaseCosts: 'purchase_price * purchase_cost_rate',
      transformationCost: 'new_units_created * cost_per_new_unit',
      projectCost: 'purchase_price + purchase_costs + transformation_cost',
      sellingCost: 'exit_value * selling_cost_rate',
      totalCost: 'project_cost + selling_cost',
      profitLoss: 'exit_value - total_cost',
      roi: '(profit_loss / total_cost) * 100',
      marginOnSales: '(profit_loss / exit_value) * 100',
    },
  };
}

export function underwritingFromResult(result = {}, assumptions = {}) {
  const listing = result.listing || result;
  const door = result.door_engine || {};
  const spread = result.spread || {};
  const gpt = result.gpt_analysis || {};
  const finalUnitPlan = Array.isArray(gpt.final_unit_plan) && gpt.final_unit_plan.length
    ? gpt.final_unit_plan
    : result.final_unit_plan || door.finalUnitPlan || [];

  return calculateUnderwriting({
    purchasePriceEur: firstNumber(listing.price, result.price_eur, result.price),
    purchaseCostRate: firstNumber(door.purchaseCostRate, result.purchase_cost_rate),
    sellingCostRate: firstNumber(door.sellingCostRate, result.selling_cost_rate),
    purchaseCostsEur: firstNumber(door.purchaseCosts, result.purchase_costs_eur, result.acquisition_costs_eur),
    newUnitsCreated: firstNumber(door.newUnitsCreated, result.new_units_created),
    costPerNewUnitEur: firstNumber(door.costPerNewUnit, result.cost_per_new_unit_eur),
    transformationCostEur: firstNumber(door.transformationCost, result.transformation_cost_eur, result.renovation_cost_eur),
    projectCostEur: firstNumber(door.estimatedProjectCost, spread.project_cost_eur, result.estimated_project_cost_eur, result.project_cost_eur),
    finalUnitPlan,
    exitValues: {
      low: firstNumber(gpt.total_sale_value_low_eur, spread.total_sale_value_low_eur, result.total_sale_value_low_eur),
      base: firstNumber(gpt.total_sale_value_base_eur, spread.total_sale_value_base_eur, result.total_sale_value_base_eur),
      high: firstNumber(gpt.total_sale_value_high_eur, spread.total_sale_value_high_eur, result.total_sale_value_high_eur),
    },
    spreadValues: {
      low: firstNumber(spread.spread_low_eur, result.spread_low_eur),
      base: firstNumber(spread.spread_base_eur, result.spread_base_eur),
      high: firstNumber(spread.spread_high_eur, result.spread_high_eur),
    },
  }, assumptions);
}

export function summarizeRoi(underwritings = []) {
  const values = underwritings
    .map((item) => numberOrNull(item?.scenarios?.base?.roiPct))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  if (!values.length) return { valuedCount: 0, averageBaseRoiPct: null, medianBaseRoiPct: null };
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return {
    valuedCount: values.length,
    averageBaseRoiPct: roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length),
    medianBaseRoiPct: roundPercent(median),
  };
}
