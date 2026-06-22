import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const rootDir = process.cwd();
const allowedPrefixes = ['triage-outputs/', 'outputs/triage/'];

function normalizeId(value) {
  return String(value || '').replaceAll('\\\\', '/').replace(/^\/+/, '');
}

function isAllowedId(id) {
  if (!id.endsWith('.json')) return false;
  if (id.includes('..')) return false;
  return allowedPrefixes.some((prefix) => id.startsWith(prefix));
}

export default async function handler(request, response) {
  try {
    const id = normalizeId(request.query.file);
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
