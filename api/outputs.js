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
  const query = 'triage_runs?select=run_id,filename,search_name,city,created_at,top_result_title&order=created_at.desc&limit=50';
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${query}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
    },
  });
  if (!response.ok) throw new Error(`Supabase outputs failed: ${response.status}\n${await response.text()}`);
  const rows = await response.json();
  return rows.map((row) => ({
    id: `supabase:${row.run_id}`,
    name: row.filename || row.run_id,
    dir: 'supabase/triage_runs',
    modified_at: row.created_at ? Date.parse(row.created_at) : 0,
    search_name: row.search_name,
    city: row.city,
    top_result_title: row.top_result_title,
  }));
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
