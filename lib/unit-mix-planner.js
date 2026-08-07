function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundOne(value) {
  return Number(value.toFixed(1));
}

function distributeArea(count, minimumMq, totalAreaMq) {
  if (count <= 0) return [];
  const baseSize = roundOne(totalAreaMq / count);
  const sizes = Array.from({ length: count }, () => baseSize);
  const correction = roundOne(totalAreaMq - sizes.reduce((sum, size) => sum + size, 0));
  sizes[sizes.length - 1] = roundOne(sizes[sizes.length - 1] + correction);
  return sizes.map((size) => Math.max(minimumMq, size));
}

/**
 * Provisional max-doors planner.
 *
 * It creates as many bilocali as fit at their configured minimum size, then
 * preserves one smaller residual as a monolocale only when it reaches the
 * conservative minimum. If it does not, the residual is redistributed across
 * the bilocali instead of being discarded.
 */
export function planFinalUnitMix(grossAreaMq, investorProfile = {}) {
  const grossArea = Number(grossAreaMq);
  if (!Number.isFinite(grossArea) || grossArea <= 0) {
    return {
      planningVersion: 'max_doors_residual_studio_v2',
      saleableAreaMq: null,
      plannedUnitMix: [],
      residualStudioIncluded: false,
    };
  }

  const planning = investorProfile.unit_mix_planning || {};
  const saleableAreaRatio = positiveNumber(planning.saleable_area_ratio, 0.92);
  const bilocale = investorProfile.target_unit_types?.bilocale || {};
  const monolocale = investorProfile.target_unit_types?.monolocale || {};
  const bilocaleMinimumMq = positiveNumber(bilocale.min_mq, 40);
  const monolocaleMinimumMq = positiveNumber(monolocale.min_mq, 28);
  const saleableAreaMq = roundOne(grossArea * saleableAreaRatio);
  const minimumSplitAreaMq = bilocaleMinimumMq + monolocaleMinimumMq;

  if (saleableAreaMq < minimumSplitAreaMq) {
    return {
      planningVersion: 'max_doors_residual_studio_v2',
      saleableAreaMq,
      saleableAreaRatio,
      bilocaleMinimumMq,
      monolocaleMinimumMq,
      plannedUnitMix: [{
        unit_type: 'existing_unit',
        estimated_size_mq: saleableAreaMq,
        planning_role: 'not_fractioned',
      }],
      residualStudioIncluded: false,
    };
  }

  const bilocaleCount = Math.floor(saleableAreaMq / bilocaleMinimumMq);
  const residualMq = roundOne(saleableAreaMq - (bilocaleCount * bilocaleMinimumMq));
  const residualStudioIncluded = residualMq >= monolocaleMinimumMq;
  const bilocaleAreaTotal = residualStudioIncluded
    ? bilocaleCount * bilocaleMinimumMq
    : saleableAreaMq;
  const bilocaleSizes = distributeArea(bilocaleCount, bilocaleMinimumMq, bilocaleAreaTotal);
  const plannedUnitMix = bilocaleSizes.map((size) => ({
    unit_type: 'bilocale',
    estimated_size_mq: size,
    planning_role: 'primary_unit',
  }));

  if (residualStudioIncluded) {
    plannedUnitMix.push({
      unit_type: 'monolocale',
      estimated_size_mq: residualMq,
      planning_role: 'residual_unit',
    });
  }

  return {
    planningVersion: 'max_doors_residual_studio_v2',
    saleableAreaMq,
    saleableAreaRatio,
    bilocaleMinimumMq,
    monolocaleMinimumMq,
    plannedUnitMix,
    residualStudioIncluded,
  };
}
