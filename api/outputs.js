import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const rootDir = process.cwd();
const dirs = ['triage-outputs', 'outputs/triage'];

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

export default async function handler(_request, response) {
  const outputs = [];
  for (const dir of dirs) outputs.push(...await readDirSafe(dir));
  response.status(200).json({ outputs: outputs.sort((a, b) => b.modified_at - a.modified_at) });
}
