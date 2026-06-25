import { jsonResponse, numberParam, sendError, supabaseGet } from './_supabase-debug.js';

export default async function handler(request, response) {
  try {
    const limit = numberParam(request.query.limit, 20, 100);
    const raw = request.query.raw === '1' || request.query.raw === 'true';
    const select = raw
      ? '*'
      : 'run_id,created_at,search_name,city,investor_profile,raw_source_count,scraped_count,eligible_count,filtered_out_count,pre_scored_count,gpt_candidate_count,gpt_analyzed_count,source_channels,requested_areas,query_payloads,result_links,top_result_url,top_result_title,top_result_score,top_result_spread_base_eur,top_result_roi_base_pct';

    const rows = await supabaseGet(`triage_runs?select=${select}&order=created_at.desc&limit=${limit}`);
    jsonResponse(response, { count: rows.length, rows });
  } catch (error) {
    sendError(response, 500, error.message);
  }
}
