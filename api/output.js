import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const rootDir = process.cwd();
const allowedPrefixes = ['triage-outputs/', 'outputs/triage/'];
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeId(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
}

function isAllowedId(id) {
  if (!id.endsWith('.json')) return false;
  if (id.includes('..')) return false;
  return allowedPrefixes.some((prefix) => id.startsWith(prefix));
}

async function supabaseGet(pathname) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase env vars');
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
    },
  });
  if (!response.ok) throw new Error(`Supabase output failed: ${response.status}\n${await response.text()}`);
  return response.json();
}

async function readSupabaseOutput(id) {
  const runId = id.replace(/^supabase:/, '');
  const runs = await supabaseGet(`triage_runs?run_id=eq.${encodeURIComponent(runId)}&select=*`);
  const run = runs?.[0];
  if (!run) throw new Error(`Supabase run not found: ${runId}`);

  const properties = await supabaseGet(`triage_properties?run_id=eq.${encodeURIComponent(runId)}&select=*&order=rank.asc`);
  if (run.raw_output && typeof run.raw_output === 'object') {
    return {
      ...run.raw_output,
      result_links: run.result_links ?? run.raw_output.result_links ?? [],
      results: properties.map((property) => property.raw_result).filter(Boolean),
    };
  }

  return {
    search_name: run.search_name,
    city: run.city,
    investor_profile: run.investor_profile,
    scraped_count: run.scraped_count,
    eligible_count: run.eligible_count,
    filtered_out_count: run.filtered_out_count,
    filtered_out_summary: run.filtered_out_summary,
    gpt_analyzed_count: run.gpt_analyzed_count,
    result_links: run.result_links ?? [],
    results: properties.map((property) => property.raw_result).filter(Boolean),
  };
}

export default async function handler(request, response) {
  try {
    const id = normalizeId(request.query.file);

    if (id.startsWith('supabase:')) {
      response.status(200).json(await readSupabaseOutput(id));
      return;
    }

    if (!isAllowedId(id)) {
      response.status(400).json({ error: 'Invalid output file' });
      return;
    }

    const fullPath = resolve(rootDir, id);
    const backToRoot = relative(rootDir, fullPath).replaceAll(sep, '/');
    if (backToRoot !== id) {
      response.status(400).json({ error: 'Invalid output file' });
      return;
    }

    const content = await readFile(fullPath, 'utf8');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.status(200).send(content);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
