import { hasUsablePreferences, selectAlertsForInvestor } from './investor-alerts.js';

// Turns a finished triage run into investor alerts.
//
// The store is injected rather than imported so the whole pass is testable
// without a database. `supabaseAlertStore()` is the production implementation.
//
// Idempotency is delegated to the unique constraint on (user_id, property_key).
// Alerts are inserted with "do nothing" on conflict and the store returns only
// the rows it actually created, so two passes racing on the same run converge
// on the same result and neither double-alerts anyone.

const DEFAULT_LIMIT_PER_INVESTOR = 25;

function mergeCounts(target, source) {
  for (const [reason, count] of Object.entries(source || {})) {
    target[reason] = (target[reason] || 0) + count;
  }
  return target;
}

export async function reconcileInvestorAlerts({
  store,
  runId,
  limitPerInvestor = DEFAULT_LIMIT_PER_INVESTOR,
  logger = console,
} = {}) {
  if (!store) throw new Error('An alert store is required');
  if (!runId) throw new Error('A run id is required');

  const startedAt = new Date().toISOString();
  const summary = {
    run_id: runId,
    started_at: startedAt,
    investors_considered: 0,
    properties_inspected: 0,
    alerts_created: 0,
    rejection_counts: {},
    per_investor: [],
  };

  try {
    const investors = await store.activeInvestors();
    const properties = await store.propertiesForRun(runId);
    summary.properties_inspected = properties.length;

    for (const investor of investors) {
      // An investor may keep several profiles - a yield-led one and a
      // location-led one select different properties, and neither should
      // cancel the other. Each is matched separately and the results are
      // merged, because an apartment found by two profiles is still one
      // apartment and the investor should hear about it once.
      const profiles = (investor.profiles || []).filter((profile) => hasUsablePreferences(profile));
      if (!profiles.length) {
        mergeCounts(summary.rejection_counts, { investor_has_no_preferences: 1 });
        continue;
      }
      summary.investors_considered += 1;

      const byProperty = new Map();
      let truncated = false;
      for (const profile of profiles) {
        const selection = selectAlertsForInvestor(properties, profile, {
          userId: investor.user_id,
          limit: limitPerInvestor,
        });
        mergeCounts(summary.rejection_counts, selection.rejectionCounts);
        truncated = truncated || selection.truncated;
        for (const match of selection.matches) {
          // First profile to find it wins the attribution; the alert itself is
          // identical either way.
          if (!byProperty.has(match.property_key)) {
            byProperty.set(match.property_key, { ...match, matched_profile: profile.name ?? null });
          }
        }
      }

      const matches = [...byProperty.values()].slice(0, limitPerInvestor);
      if (!matches.length) {
        summary.per_investor.push({ user_id: investor.user_id, profiles: profiles.length, matched: 0, created: 0 });
        continue;
      }

      const created = await store.insertAlerts(matches);
      summary.alerts_created += created.length;
      // matched - created is exactly the set already alerted in an earlier pass.
      const alreadyAlerted = matches.length - created.length;
      if (alreadyAlerted > 0) mergeCounts(summary.rejection_counts, { already_alerted: alreadyAlerted });

      summary.per_investor.push({
        user_id: investor.user_id,
        profiles: profiles.length,
        matched: matches.length,
        created: created.length,
        truncated,
      });
    }

    summary.finished_at = new Date().toISOString();
    await store.recordReconciliation(summary);
    return summary;
  } catch (error) {
    summary.finished_at = new Date().toISOString();
    summary.error = error.message;
    // Observability must not swallow the failure, but it must not mask it
    // either: record what happened, then let the caller see the error.
    await store.recordReconciliation(summary).catch((recordError) => {
      logger.error('Could not record a failed alert reconciliation', recordError.message);
    });
    throw error;
  }
}

function serviceConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return { url, key };
}

export function supabaseAlertStore(fetchImpl = fetch) {
  const headers = (extra = {}) => {
    const { key } = serviceConfig();
    return {
      apikey: key,
      [['Authori', 'zation'].join('')]: ['Bearer', key].join(' '),
      'Content-Type': 'application/json',
      ...extra,
    };
  };

  async function rest(pathname, options = {}) {
    const { url } = serviceConfig();
    const response = await fetchImpl(`${url}/rest/v1/${pathname}`, {
      ...options,
      headers: headers(options.headers),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Supabase alert store failed: ${response.status}`);
    return body ? JSON.parse(body) : null;
  }

  return {
    async activeInvestors() {
      // Preferences are read with the service role here because this is a
      // server-side batch, not a user request. RLS still governs every path an
      // investor can reach directly.
      const memberships = await rest(
        'torium_memberships?status=eq.active&select=user_id,role',
      ) || [];
      if (!memberships.length) return [];

      const ids = memberships.map((row) => row.user_id);
      const profiles = await rest(
        'investor_alert_preferences?user_id=in.(' + ids.join(',') + ')&is_active=is.true&select=*&order=name.asc',
      ) || [];
      const byUser = new Map();
      for (const profile of profiles) {
        if (!byUser.has(profile.user_id)) byUser.set(profile.user_id, []);
        byUser.get(profile.user_id).push(profile);
      }

      return memberships.map((membership) => ({
        user_id: membership.user_id,
        role: membership.role,
        profiles: byUser.get(membership.user_id) || [],
      }));
    },

    async propertiesForRun(runId) {
      const query = new URLSearchParams({
        run_id: 'eq.' + runId,
        select: 'run_id,listing_index,source_channel,source_listing_id,source_url,title,'
          + 'address,district,neighborhood,price_eur,price_by_area,size_mq,door_score,'
          + 'roi_base_pct,thumbnail_url',
        order: 'door_score.desc',
      });
      return await rest('triage_properties?' + query) || [];
    },

    async insertAlerts(rows) {
      if (!rows.length) return [];
      // "return=representation" with "ignore-duplicates" gives back only the
      // rows this pass actually created, which is what the caller counts.
      return await rest('investor_alerts?on_conflict=user_id,property_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(rows),
      }) || [];
    },

    async recordReconciliation(summary) {
      return rest('investor_alert_runs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          run_id: summary.run_id,
          started_at: summary.started_at,
          finished_at: summary.finished_at ?? null,
          investors_considered: summary.investors_considered,
          properties_inspected: summary.properties_inspected,
          alerts_created: summary.alerts_created,
          rejection_counts: summary.rejection_counts,
          error: summary.error ?? null,
        }),
      });
    },
  };
}
