function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function roundTo(value, increment) {
  return Math.round(value / increment) * increment;
}

function collectLocationText(sourceRow, listing) {
  return normalizeText([
    sourceRow?.query_area,
    sourceRow?.area_label,
    sourceRow?.district,
    sourceRow?.neighborhood,
    sourceRow?.title,
    sourceRow?.address,
    listing?.area_label,
    listing?.district,
    listing?.neighborhood,
    listing?.title,
    listing?.address,
  ].filter(Boolean).join(' | '));
}

export function resolveMicrozoneProfile(profileSet, sourceRow, listing) {
  const locationText = collectLocationText(sourceRow, listing);
  const matches = (profileSet?.microzones || []).filter((profile) =>
    (profile.aliases || []).some((alias) => locationText.includes(normalizeText(alias)))
  );
  if (!matches.length) {
    throw new Error(`No deterministic valuation profile matches ${sourceRow?.query_area || sourceRow?.area_label || listing?.address || 'this listing'}`);
  }
  return matches.sort((left, right) => {
    const leftSpecificity = Math.max(...left.aliases.map((alias) => normalizeText(alias).length));
    const rightSpecificity = Math.max(...right.aliases.map((alias) => normalizeText(alias).length));
    return rightSpecificity - leftSpecificity;
  })[0];
}

function unitBand(profile, sizeMq, unitType) {
  const bands = profile.unit_size_bands || [];
  return bands.find((band) => band.unit_type === unitType && sizeMq <= Number(band.max_mq))
    || bands.find((band) => sizeMq <= Number(band.max_mq));
}

export function buildDeterministicValuation({ profileSet, sourceRow, listing, doorEngine }) {
  const grossAreaMq = Number(listing?.size ?? doorEngine?.basics?.surfaceMq);
  const finalUnits = Number(doorEngine?.estimatedFinalUnits);
  if (!Number.isFinite(grossAreaMq) || grossAreaMq <= 0 || !Number.isInteger(finalUnits) || finalUnits <= 0) {
    throw new Error('Deterministic valuation requires a positive surface and final-unit count');
  }
  const newUnitsCreated = Number(doorEngine?.newUnitsCreated ?? finalUnits - 1);
  if (finalUnits < 2 || !Number.isFinite(newUnitsCreated) || newUnitsCreated < 1) {
    return {
      valuation_method: 'not_applicable_no_fractioning',
      valuation_applicability: 'not_applicable_no_fractioning',
      valuation_profile_version: profileSet.version,
      final_unit_plan: [],
      total_sale_value_low_eur: null,
      total_sale_value_base_eur: null,
      total_sale_value_high_eur: null,
      fractioning_confidence: 'unknown',
      valuation_confidence: 'unknown',
      positive_signals: [],
      red_flags: ['ROI frazionamento non applicabile: il progetto non crea nuove unità.'],
      missing_information: ['Una strategia separata di renovation/flip non è ancora modellata.'],
      human_due_diligence_questions: [],
      recommended_action: 'monitor',
    };
  }

  const profile = resolveMicrozoneProfile(profileSet, sourceRow, listing);
  const assumptions = profileSet.assumptions || {};

  const saleableAreaMq = grossAreaMq * Number(assumptions.saleable_area_ratio ?? 1);
  const plannedMix = Array.isArray(doorEngine?.plannedUnitMix)
    && doorEngine.plannedUnitMix.length === finalUnits
    && doorEngine.plannedUnitMix.every((unit) => Number(unit?.estimated_size_mq) > 0)
    ? doorEngine.plannedUnitMix
    : Array.from({ length: finalUnits }, () => ({
      unit_type: null,
      estimated_size_mq: saleableAreaMq / finalUnits,
    }));
  const roundToEur = Number(assumptions.round_to_eur ?? 1000);
  const valuedUnits = plannedMix.map((plannedUnit, index) => {
    const unitSizeMq = Number(plannedUnit.estimated_size_mq);
    const band = unitBand(profile, unitSizeMq, plannedUnit.unit_type);
    if (!band) throw new Error(`No unit-size valuation band for ${unitSizeMq.toFixed(1)} mq`);
    const baseEurMq = Number(profile.base_exit_eur_mq) * Number(band.multiplier ?? 1);
    const lowEurMq = baseEurMq * Number(assumptions.low_multiplier ?? 0.9);
    const highEurMq = baseEurMq * Number(assumptions.high_multiplier ?? 1.1);
    const valueFor = (eurMq) => roundTo(unitSizeMq * eurMq, roundToEur);
    return {
      unit_type: plannedUnit.unit_type && plannedUnit.unit_type !== 'existing_unit'
        ? plannedUnit.unit_type
        : band.unit_type,
      estimated_size_mq: Number(unitSizeMq.toFixed(1)),
      sale_value_low_eur: valueFor(lowEurMq),
      sale_value_base_eur: valueFor(baseEurMq),
      sale_value_high_eur: valueFor(highEurMq),
      unit_size_multiplier: Number(band.multiplier ?? 1),
      valuation_reasoning: `${profile.name}; ${Math.round(profile.base_exit_eur_mq)} EUR/mq benchmark x ${Number(band.multiplier).toFixed(2)} size factor; unit ${index + 1}/${finalUnits}`,
    };
  });
  const sumValues = (key) => valuedUnits.reduce((sum, unit) => sum + Number(unit[key] || 0), 0);
  const finalUnitPlan = valuedUnits.map(({ unit_size_multiplier: _multiplier, ...unit }) => unit);

  return {
    valuation_method: 'deterministic_microzone_unit_v2',
    valuation_profile_version: profileSet.version,
    valuation_microzone_id: profile.id,
    valuation_assumptions: {
      benchmark_eur_mq: profile.base_exit_eur_mq,
      unit_size_multiplier: valuedUnits.every((unit) => unit.unit_size_multiplier === valuedUnits[0].unit_size_multiplier)
        ? valuedUnits[0].unit_size_multiplier
        : null,
      unit_size_multipliers: valuedUnits.map((unit) => ({
        unit_type: unit.unit_type,
        estimated_size_mq: unit.estimated_size_mq,
        multiplier: unit.unit_size_multiplier,
      })),
      saleable_area_ratio: assumptions.saleable_area_ratio,
      unit_mix_planning_version: doorEngine?.planningVersion || 'equal_size_fallback_v1',
      scenario_multipliers: {
        low: assumptions.low_multiplier,
        base: assumptions.base_multiplier,
        high: assumptions.high_multiplier,
      },
      benchmark_sources: profile.benchmarks,
    },
    final_unit_plan: finalUnitPlan,
    total_sale_value_low_eur: sumValues('sale_value_low_eur'),
    total_sale_value_base_eur: sumValues('sale_value_base_eur'),
    total_sale_value_high_eur: sumValues('sale_value_high_eur'),
    fractioning_confidence: listing?.hasPlan ? 'medium' : 'low',
    valuation_confidence: 'medium',
    positive_signals: [
      `deterministic_profile:${profile.id}`,
      `benchmark_month:${profileSet.effective_month}`,
      `projected_units:${finalUnits}`,
      ...(doorEngine?.residualStudioIncluded ? ['residual_monolocale_planned'] : []),
    ],
    red_flags: [
      'Exit benchmark uses asking prices, not confirmed transaction prices.',
      'Small-unit premium and saleable-area ratio are expert-authored V1 assumptions.',
      ...(doorEngine?.residualStudioIncluded
        ? ['Residual monolocale feasibility requires a technician: 28 sqm is only a conservative planning threshold.']
        : []),
    ],
    missing_information: [
      'Technical validation of the final unit layout and exact saleable surface.',
      'Property-specific comparable transactions and professional appraisal.',
      'Full renovation budget beyond the configured per-new-unit transformation allowance.',
    ],
    human_due_diligence_questions: [
      'Can the projected unit count be confirmed from the floor plan and building systems?',
      'Which recent closed transactions match the projected unit sizes and condition?',
      'What is the complete renovation and commercialization budget?',
    ],
    recommended_action: 'request_details',
  };
}
