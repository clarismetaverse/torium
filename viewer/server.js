import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TORIUM_VIEWER_PORT || 5174);

const OUTPUT_DIRS = [
  path.join(ROOT, 'outputs', 'triage'),
  path.join(ROOT, 'triage-outputs'),
];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listJsonFiles() {
  const files = [];

  for (const dir of OUTPUT_DIRS) {
    if (!(await exists(dir))) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const absolutePath = path.join(dir, entry.name);
      const stat = await fs.stat(absolutePath);
      files.push({
        id: path.relative(ROOT, absolutePath).replaceAll(path.sep, '/'),
        name: entry.name,
        dir: path.relative(ROOT, dir).replaceAll(path.sep, '/'),
        modified_at: stat.mtimeMs,
      });
    }
  }

  return files.sort((a, b) => b.modified_at - a.modified_at);
}

function isAllowedOutputPath(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  return OUTPUT_DIRS.some((dir) => absolutePath.startsWith(path.resolve(dir) + path.sep));
}

async function sendJson(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value, null, 2));
}

async function sendStatic(response, filePath, contentType) {
  const content = await fs.readFile(filePath);
  response.writeHead(200, { 'Content-Type': contentType });
  response.end(content);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://localhost:${PORT}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      await sendStatic(response, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (url.pathname === '/api/outputs') {
      await sendJson(response, { outputs: await listJsonFiles() });
      return;
    }

    if (url.pathname === '/api/output') {
      const file = url.searchParams.get('file');
      if (!file || !isAllowedOutputPath(file)) {
        await sendJson(response, { error: 'Invalid output file' }, 400);
        return;
      }
      const absolutePath = path.resolve(ROOT, file);
      const content = await fs.readFile(absolutePath, 'utf8');
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(content);
      return;
    }

    await sendJson(response, { error: 'Not found' }, 404);
  } catch (error) {
    await sendJson(response, { error: error.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`TORIUM triage viewer running at http://localhost:${PORT}`);
});
