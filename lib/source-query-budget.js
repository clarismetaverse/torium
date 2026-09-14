// Allocate the budget to every query including variants and broad fallbacks.
// Require one item per query instead of silently omitting the last areas.
export function allocateQueryBudget(queries, budgetPerSource, totalBudget) {
  const groups = new Map();
  for (const q of queries) {
    if (!groups.has(q.source_channel)) groups.set(q.source_channel, []);
    groups.get(q.source_channel).push(q);
  }
  if (!Number.isInteger(budgetPerSource) || budgetPerSource < 1 || !Number.isInteger(totalBudget)
    || totalBudget < budgetPerSource * groups.size) throw Error('Invalid source/total query budget');
  const quotas = new Map();
  for (const group of groups.values()) {
    if (budgetPerSource < group.length) throw Error(`Budget needs at least ${group.length} items for all source queries`);
    group.forEach((q, i) => quotas.set(q, Math.floor(budgetPerSource / group.length) + (i < budgetPerSource % group.length ? 1 : 0)));
  }
  return queries.map(q => ({ ...q, allocated_items: quotas.get(q), payload: { ...q.payload,
    ...(q.actor === 'immobiliare-url' ? { results_wanted: quotas.get(q) } : { maxItems: quotas.get(q) }) } }));
}

// Results retain plan order regardless of completion order. A failed/deadline
// query is explicit and cannot be represented as a completed empty area.
export async function executeQueryPlan(queries, runQuery, { concurrency = 2, deadlineMs = 210000 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || !(deadlineMs > 0 && Number.isFinite(deadlineMs))) throw Error('Invalid executor limits');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Query plan deadline exceeded')), deadlineMs);
  const results = new Array(queries.length);
  let index = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, async () => {
      while (index < queries.length) {
        const current = index++, query = queries[current];
        if (controller.signal.aborted) { results[current] = { query, status: 'not_started_deadline', rawResults: [], error: controller.signal.reason }; continue; }
        try {
          const rawResults = await runQuery(query, controller.signal);
          results[current] = { query, status: 'succeeded', rawResults, error: null };
        } catch (error) {
          results[current] = { query, status: controller.signal.aborted ? 'deadline' : 'failed', rawResults: [], error };
        }
      }
    }));
    return results;
  } finally { clearTimeout(timer); }
}
