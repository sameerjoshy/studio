import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';

const ALLOWED_COMMANDS = new Set([
  'python',
  'python3',
  'ls',
  'find',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'mkdir',
  'cp',
  'mv',
]);

const MAX_OBSERVATION = 4000;
const MAX_STEPS = 40;

function clip(text, limit = MAX_OBSERVATION) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function inside(base, target) {
  const resolved = path.resolve(base, target);
  const root = path.resolve(base);
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function callModel({ system, user, maxTokens = 2600 }) {
  const base = process.env.STUDIO_BASE_URL;
  const secret = process.env.RUNNER_SECRET;
  if (!base || !secret) throw new Error('STUDIO_BASE_URL and RUNNER_SECRET are required');

  const response = await fetch(`${base}/api/internal/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-runner-secret': secret },
    body: JSON.stringify({ system, user, maxTokens }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`Model gateway ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  return response.json();
}

async function listFiles(repo, rel = '.') {
  const target = path.resolve(repo, rel);
  if (!inside(repo, target)) return 'Path escapes the repository.';

  const skip = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);
  const entries = [];

  async function walk(dir) {
    if (entries.length >= 400) return;
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.length >= 400) break;
      if (skip.has(child.name)) continue;
      const full = path.join(dir, child.name);
      const relative = path.relative(repo, full).split(path.sep).join('/');
      if (child.isDirectory()) {
        entries.push(`${relative}/`);
        await walk(full);
      } else {
        entries.push(relative);
      }
    }
  }

  await walk(target);
  return entries.length ? entries.join('\n') : '(empty)';
}

async function readText(repo, rel, offset = 0, limit = 6000) {
  const target = path.resolve(repo, rel);
  if (!inside(repo, target)) return 'Path escapes the repository.';
  try {
    const text = await readFile(target, 'utf8');
    if (text.includes('\u0000')) return 'Binary file.';
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(12_000, Math.max(500, Number(limit) || 6000));
    return clip(text.slice(start, start + size), size + 200);
  } catch (error) {
    return `Could not read ${rel}: ${error.message}`;
  }
}

async function writeText(project, rel, content) {
  const target = path.resolve(project, rel);
  if (!inside(project, target)) return 'Refused: writes are limited to the project directory.';
  if (typeof content !== 'string') return 'content must be a string';
  if (content.length > 120_000) return 'Refused: file too large.';

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return `Wrote ${content.length} bytes to ${path.relative(project, target)}`;
}

function parseCommand(command) {
  const value = String(command ?? '').trim();
  if (!value) return { error: 'Empty command.' };
  if (/[;&|<>`$]/.test(value)) return { error: 'Shell operators are not allowed.' };

  const [binary, ...args] = value.split(/\s+/);
  const base = binary.includes('/') ? binary.split('/').pop() : binary;
  if (!ALLOWED_COMMANDS.has(base)) {
    return { error: `Command "${base}" is not allowed. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}` };
  }
  return { binary, args };
}

async function executeCommand(repo, command) {
  const parsed = parseCommand(command);
  if (parsed.error) return parsed.error;

  try {
    const result = await run(parsed.binary, parsed.args, {
      cwd: repo,
      shell: false,
      timeoutMs: 300_000,
    });
    return clip(`exit=0\n${result.stdout}\n${result.stderr}`.trim());
  } catch (error) {
    return clip(`FAILED: ${error.message}`);
  }
}

function buildSystem({ repo, project, slides, audience }) {
  const skill = path.join(repo, 'skills', 'ppt-master');

  return [
    'You are PPT Master executing in headless Quick mode. You author real slide SVGs and export a native PowerPoint.',
    '',
    `REPO = ${repo}`,
    `SKILL_DIR = ${skill}`,
    `PROJECT = ${project}`,
    '',
    'You may read files anywhere in REPO, but you may only WRITE inside PROJECT. Never modify SKILL_DIR.',
    '',
    'DELIVERABLE',
    `- ${slides} slides, 16:9 canvas, for ${audience}.`,
    '- One file per slide: PROJECT/svg_output/P01.svg, P02.svg, ...',
    '- Then run the checker and the exporter, then call finish.',
    '',
    'SVG CONTRACT (follow exactly)',
    '- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" lang="en" data-pptx-page-role="cover|content|closing">',
    '- Background: <rect x="0" y="0" width="1280" height="720" fill="#0A192F" data-pptx-role="background"/>',
    '- Group each logical unit in <g id="...">. Put text in <text> elements, never in foreignObject.',
    '- Valid XML: write raw Unicode (—, ·, →). Escape & as &amp;, < as &lt;. No HTML entities.',
    '- Fonts: Arial only. Title 44-64px, body 20-28px, footnote >= 16px.',
    '- Colors: uppercase #RRGGBB. Palette: #0A192F ink, #112240 panel, #4F46E5 accent, #34D399 mint, #E2E8F0 text, #94A3B8 muted, #FFFFFF white.',
    '- Text must stay inside the canvas. Use <tspan> for manual line breaks. No overflow, no clipping.',
    '',
    'QUALITY BAR',
    '- A cover, N-2 content pages, and a closing page.',
    '- Every content page: one clear takeaway, 3-5 supporting points, consistent margins (72px), readable contrast.',
    '- Vary layout across pages (split, numbered list, quote, comparison) but keep one visual system.',
    '- Write real, specific copy for the brief. No lorem ipsum, no "Title here".',
    '',
    'COMMANDS (run from REPO, no shell operators)',
    `1. python3 ${skill}/scripts/svg_quality_checker.py ${project} --quick-generate`,
    `2. python3 ${skill}/scripts/svg_to_pptx.py ${project} --quick-generate`,
    'Fix ERROR findings and re-run. Warnings are acceptable.',
    '',
    'TOOLS (one JSON object per turn)',
    '{"thought":"...","action":"list_files","args":{"path":"."}}',
    '{"thought":"...","action":"read_file","args":{"path":"...","offset":0,"limit":6000}}',
    '{"thought":"...","action":"write_file","args":{"path":"svg_output/P01.svg","content":"<svg ...>"}}',
    '{"thought":"...","action":"run_command","args":{"command":"python3 ..."}}',
    '{"thought":"...","action":"finish","args":{"summary":"..."}}',
    '',
    'Rules: one action per turn. Do not ask questions. Do not re-read a file you already read. Keep responses small.',
    'Respond with the JSON object only, no prose outside it.',
  ].join('\n');
}

function compactAction(action) {
  const name = action?.action ?? 'unknown';
  const args = action?.args ?? {};
  if (name === 'write_file') {
    return JSON.stringify({ action: name, path: args.path, bytes: String(args.content ?? '').length });
  }
  if (name === 'read_file') {
    return JSON.stringify({ action: name, path: args.path });
  }
  if (name === 'run_command') {
    return JSON.stringify({ action: name, command: String(args.command ?? '').slice(0, 160) });
  }
  return JSON.stringify({ action: name, thought: String(action?.thought ?? '').slice(0, 200) });
}

export async function runHarness({ repo, project, brief, slides, audience, progress }) {
  const system = buildSystem({ repo, project, slides, audience });
  const intro = [
    'BEGIN.',
    `BRIEF:\n${brief}`,
    `Slide count: ${slides}`,
    `Audience: ${audience}`,
    'Start by writing P01.svg. Work one slide at a time, then run the checker and exporter.',
  ].join('\n\n');

  const history = [intro];
  const providers = new Set();
  let steps = 0;

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    steps = step;
    const percent = Math.min(86, 16 + Math.round((step / MAX_STEPS) * 70));
    await progress('authoring', percent, `Harness step ${step}`);

    const user = [history[0], ...history.slice(1).slice(-10)].join('\n\n');
    const result = await callModel({ system, user });
    providers.add(result.provider);

    const action = result.data ?? {};
    const name = String(action.action ?? '');
    const args = action.args ?? {};
    let observation = '';

    if (name === 'write_file') {
      observation = await writeText(project, String(args.path ?? ''), args.content);
    } else if (name === 'read_file') {
      observation = await readText(repo, String(args.path ?? ''), args.offset, args.limit);
    } else if (name === 'list_files') {
      observation = await listFiles(repo, String(args.path ?? '.'));
    } else if (name === 'run_command') {
      observation = await executeCommand(repo, String(args.command ?? ''));
      if (/svg_to_pptx\.py/.test(String(args.command ?? '')) && observation.startsWith('exit=0')) {
        history.push(`ASSISTANT: ${compactAction(action)}`);
        history.push(`OBSERVATION: ${observation}`);
        return { providers: [...providers], steps };
      }
    } else if (name === 'finish') {
      history.push(`ASSISTANT: ${compactAction(action)}`);
      return { providers: [...providers], steps };
    } else {
      observation = `Unknown action "${name}". Use list_files, read_file, write_file, run_command, or finish.`;
    }

    history.push(`ASSISTANT: ${compactAction(action)}`);
    history.push(`OBSERVATION: ${clip(observation)}`);
  }

  return { providers: [...providers], steps };
}
