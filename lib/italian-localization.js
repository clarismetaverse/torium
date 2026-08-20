function normalized(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const EXACT_FLOORS = new Map([
  ['bj', 'Piano terra'],
  ['bajo', 'Piano terra'],
  ['baja', 'Piano terra'],
  ['pb', 'Piano terra'],
  ['planta baja', 'Piano terra'],
  ['ground floor', 'Piano terra'],
  ['terra', 'Piano terra'],
  ['piano terra', 'Piano terra'],
  ['en', 'Ammezzato'],
  ['ent', 'Ammezzato'],
  ['entresuelo', 'Ammezzato'],
  ['entreplanta', 'Ammezzato'],
  ['mezzanine', 'Ammezzato'],
  ['ammezzato', 'Ammezzato'],
  ['atico', 'Attico'],
  ['attico', 'Attico'],
  ['ss', 'Seminterrato'],
  ['semisotano', 'Seminterrato'],
  ['seminterrato', 'Seminterrato'],
  ['sotano', 'Interrato'],
  ['basement', 'Interrato'],
  ['interrato', 'Interrato'],
]);

export function normalizeItalianFloor(value) {
  if (value === null || value === undefined || value === '') return null;
  const source = String(value).trim();
  const key = normalized(source);
  if (EXACT_FLOORS.has(key)) return EXACT_FLOORS.get(key);

  const basement = key.match(/^(?:s|sotano|piano interrato)\s*[- ]?([1-9])$/);
  if (basement) return `${basement[1]}° piano interrato`;

  const numbered = key.match(/^(?:planta|piano)?\s*(-?\d+)\s*(?:a|o|ª|º|°)?$/);
  if (numbered) {
    const floor = Number(numbered[1]);
    if (floor === 0) return 'Piano terra';
    if (floor < 0) return `${Math.abs(floor)}° piano interrato`;
    return `${floor}° piano`;
  }

  return source;
}

const EXACT_ANALYSIS_TRANSLATIONS = new Map([
  ['Exit benchmark uses asking prices, not confirmed transaction prices.', 'Il benchmark di uscita utilizza prezzi richiesti, non prezzi di compravendite confermate.'],
  ['City-zone asking-price benchmark, small-unit premium and saleable-area ratio are provisional assumptions.', 'Il benchmark dei prezzi richiesti per zona, il premio per i piccoli tagli e il rapporto di superficie vendibile sono ipotesi provvisorie.'],
  ['No specific Milan macro-zone matched; citywide fallback benchmark used.', 'Non è stata riconosciuta una macrozona specifica di Milano: è stato utilizzato il benchmark cittadino generale.'],
  ['Residual monolocale feasibility requires a technician: 28 sqm is only a conservative planning threshold.', 'La fattibilità del monolocale residuo deve essere verificata da un tecnico: 28 mq è soltanto una soglia progettuale prudenziale.'],
  ['Technical validation of the final unit layout and exact saleable surface.', 'Validazione tecnica della distribuzione finale delle unità e della superficie vendibile effettiva.'],
  ['Property-specific comparable transactions and professional appraisal.', 'Compravendite comparabili specifiche per l’immobile e perizia professionale.'],
  ['Full renovation budget beyond the configured per-new-unit transformation allowance.', 'Budget completo della ristrutturazione oltre alla stima parametrica configurata per unità.'],
  ['Can the projected unit count be confirmed from the floor plan and building systems?', 'La planimetria e gli impianti dell’edificio confermano il numero di unità ipotizzato?'],
  ['Which recent closed transactions match the projected unit sizes and condition?', 'Quali compravendite recenti e concluse sono comparabili per metratura e stato delle unità previste?'],
  ['What is the complete renovation and commercialization budget?', 'Qual è il budget completo per ristrutturazione e commercializzazione?'],
  ['GPT analysis not run yet; this is a massive pre-score candidate.', 'Analisi AI non ancora eseguita: questo immobile è un candidato della preselezione massiva.'],
]);

const SENTIMENT_LABELS = {
  positive: 'positivo',
  strong_positive: 'molto positivo',
  positive_watch: 'positivo, da monitorare',
  stable_positive_outlook: 'stabile con prospettive positive',
  stable: 'stabile',
  soft: 'debole',
  not_available: 'non disponibile',
};

export function translateAnalysisItemToItalian(value) {
  const source = String(value ?? '').trim();
  if (!source) return source;
  if (EXACT_ANALYSIS_TRANSLATIONS.has(source)) return EXACT_ANALYSIS_TRANSLATIONS.get(source);

  const separator = source.indexOf(':');
  const key = separator >= 0 ? source.slice(0, separator) : '';
  const detail = separator >= 0 ? source.slice(separator + 1).trim() : '';
  if (key === 'deterministic_profile') return `Profilo di valutazione: ${detail.replaceAll('-', ' ')}`;
  if (key === 'benchmark_month') return `Mese del benchmark: ${detail}`;
  if (key === 'market_sentiment') return `Andamento di mercato: ${SENTIMENT_LABELS[detail] || detail.replaceAll('_', ' ')}`;
  if (key === 'projected_units') return `Unità finali stimate: ${detail}`;
  if (key === 'source') return `Fonte: ${detail}`;
  if (key === 'query_area') return `Area di ricerca: ${detail}`;
  if (key === 'listing_area') return `Zona dell’immobile: ${detail}`;
  if (key === 'price_m2') return `Prezzo richiesto al mq: €${detail}`;
  if (key === 'condition') return `Stato dell’immobile: ${detail === 'renew' ? 'da ristrutturare' : detail}`;
  if (key === 'risk_feature') return `Elemento di rischio da verificare: ${detail}`;

  const codes = {
    residual_monolocale_planned: 'Previsto un monolocale residuo da validare tecnicamente.',
    condition_renew_spread_signal: 'Immobile da ristrutturare: potenziale margine di valorizzazione.',
    condition_good_low_spread: 'Immobile in buono stato: margine di trasformazione potenzialmente ridotto.',
    condition_excellent_low_spread: 'Immobile in ottimo stato: margine di trasformazione potenzialmente ridotto.',
    condition_newconstruction_low_spread: 'Nuova costruzione: priorità bassa per una strategia di valorizzazione.',
    high_price_m2_low_spread_risk: 'Prezzo al mq elevato: possibile margine di valorizzazione ridotto.',
    basement_or_interrato_risk: 'Piano interrato o seminterrato da verificare.',
    attic_or_mansarda_check: 'Mansarda o sottotetto da verificare.',
    villa_typology_risk: 'Tipologia villa: non coerente con il frazionamento standard.',
    is_new_true: 'Immobile di nuova costruzione: priorità bassa.',
  };
  return codes[source] || source;
}

export function translateAnalysisItemsToItalian(items) {
  return (Array.isArray(items) ? items : []).map(translateAnalysisItemToItalian);
}
