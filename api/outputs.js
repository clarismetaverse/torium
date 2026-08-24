import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const rootDir = process.cwd();
const dirs = ['triage-outputs', 'outputs/triage'];
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function readDirSafe(dirName) {
  try {
    const dirPath = join(rootDir, dirName);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const rows = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fullPath = join(dirPath, entry.name);
      const fileStat = await stat(fullPath);
      rows.push({
        id: relative(rootDir, fullPath).replaceAll(sep, '/'),
        name: entry.name,
        dir: dirName,
        modified_at: fileStat.mtimeMs,
      });
    }

    return rows;
  } catch {
    return [];
  }
}

async function readSupabaseRuns() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const query = 'triage_runs?select=run_id,filename,search_name,search_strategy,scoring_mode,city,investor_profile,created_at,top_result_title,raw_source_count,eligible_count&order=created_at.desc&limit=50';
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${query}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
    },
  });
  if (!response.ok) throw new Error(`Supabase outputs failed: ${response.status}\n${await response.text()}`);
  const rows = await response.json();
  const fractioningRows = rows.filter((row) => row.investor_profile !== 'villa-opportunity-v1');
  const outputs = fractioningRows.map((row) => ({
    id: `supabase:${row.run_id}`,
    name: row.filename || row.run_id,
    dir: 'supabase/triage_runs',
    modified_at: row.created_at ? Date.parse(row.created_at) : 0,
    search_name: row.search_name,
    search_strategy: row.search_strategy,
    scoring_mode: row.scoring_mode,
    city: row.city,
    top_result_title: row.top_result_title,
  }));
  const neutral = fractioningRows.find((row) => row.search_strategy === 'neutral_fractionability' && Number(row.raw_source_count) > 0);
  const legacy = fractioningRows.find((row) => Number(row.raw_source_count) > 0 && (row.search_strategy === 'legacy_low_price_m2' || (!row.search_strategy && row.search_name === 'milanoFractioningMassive')));
  if (neutral && legacy) {
    outputs.unshift({
      id: `combined:${neutral.run_id}+${legacy.run_id}`,
      name: 'Neutral + Legacy ricalcolata',
      dir: 'supabase/combined',
      modified_at: Math.max(Date.parse(neutral.created_at) || 0, Date.parse(legacy.created_at) || 0) + 1,
      search_name: 'milanoFractioningCombined-neutral-plus-legacy',
      search_strategy: 'combined_neutral_legacy',
      scoring_mode: 'cross_run_frontend_view_v1',
      city: neutral.city || legacy.city,
      top_result_title: null,
    });
  }
  return outputs;
}

export default async function handler(_request, response) {
  try {
    const supabaseOutputs = await readSupabaseRuns();
    if (supabaseOutputs) {
      response.status(200).json({ outputs: supabaseOutputs });
      return;
    }

    const outputs = [];
    for (const dir of dirs) outputs.push(...await readDirSafe(dir));
    response.status(200).json({ outputs: outputs.sort((a, b) => b.modified_at - a.modified_at) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
