import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';

const MAX_REPAIR_ROUNDS = 2;

const PALETTE = {
  ink: '#0A192F',
  panel: '#112240',
  accent: '#4F46E5',
  mint: '#34D399',
  text: '#E2E8F0',
  muted: '#94A3B8',
  white: '#FFFFFF',
};

const SVG_RULES = [
  'SVG CONTRACT (violating these causes blocking checker errors)',
  '- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" lang="en" data-pptx-page-role="cover|content|closing">',
  '- Background: <rect x="0" y="0" width="1280" height="720" fill="#0A192F"/> with NO data-pptx-role and NO id.',
  '- Do NOT use <g> elements at all. Every <rect>, <line>, and <text> sits directly under <svg>.',
  '- One <text> per paragraph. Extra lines use <tspan x="SAME_X" dy="LINE_HEIGHT">. Never split a paragraph across sibling <text> elements.',
  '- Valid XML. Raw Unicode is fine (—, ·, →). Escape & as &amp; and < as &lt;. No HTML entities.',
  '- Fonts: Arial only. Body 22-28px, title 44-60px, footnote >= 16px.',
  `- Colors: uppercase #RRGGBB only. Palette: ink ${PALETTE.ink}, panel ${PALETTE.panel}, accent ${PALETTE.accent}, mint ${PALETTE.mint}, text ${PALETTE.text}, muted ${PALETTE.muted}, white ${PALETTE.white}.`,
  '- Keep all text inside x 72-1208 and y 60-680. Keep body content above y=620 so the footer band stays clear. No overflow.',
  '- Never print the page role (cover/content/closing) as visible copy. Section labels must be thematic.',
  '- Never use <g>, <foreignObject>, gradients, filters, images, or external references.',
  '',
  'REFERENCE SLIDE (copy this structure, change only content and colors)',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" lang="en" data-pptx-page-role="content">',
  `  <rect x="0" y="0" width="1280" height="720" fill="${PALETTE.ink}"/>`,
  `  <text x="72" y="96" font-family="Arial" font-size="20" fill="${PALETTE.mint}">SECTION LABEL</text>`,
  `  <text x="72" y="172" font-family="Arial" font-size="48" font-weight="bold" fill="${PALETTE.white}">Slide title goes here</text>`,
  `  <text x="72" y="264" font-family="Arial" font-size="26" fill="${PALETTE.text}">First point that explains the idea.<tspan x="72" dy="46">Second point with a concrete detail.</tspan><tspan x="72" dy="46">Third point that closes the loop.</tspan></text>`,
  `  <text x="72" y="668" font-family="Arial" font-size="18" fill="${PALETTE.muted}">GTM-360 - Studio</text>`,
  `  <text x="1208" y="668" text-anchor="end" font-family="Arial" font-size="18" fill="${PALETTE.muted}">2</text>`,
  '</svg>',
].join('\n');

async function callModel({ system, user, maxTokens = 3200, prefer = 'deepseek' }) {
  const base = process.env.STUDIO_BASE_URL;
  const secret = process.env.RUNNER_SECRET;
  if (!base || !secret) throw new Error('STUDIO_BASE_URL and RUNNER_SECRET are required');

  const response = await fetch(`${base}/api/internal/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-runner-secret': secret },
    body: JSON.stringify({ system, user, maxTokens, prefer }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new Error(`Model gateway ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = await response.json();
  return {
    data: payload.data ?? {},
    provider: payload.provider ?? 'unknown',
    usage: payload.usage ?? { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
  };
}

function cleanSvg(value) {
  let svg = String(value ?? '').trim();
  if (svg.startsWith('```')) {
    svg = svg.replace(/^```(?:svg)?/i, '').replace(/```$/, '').trim();
  }
  const start = svg.indexOf('<svg');
  const end = svg.lastIndexOf('</svg>');
  if (start >= 0 && end > start) svg = svg.slice(start, end + 6);
  return svg;
}

function validSvg(svg) {
  return (
    svg.startsWith('<svg') &&
    svg.endsWith('</svg>') &&
    svg.includes('viewBox="0 0 1280 720"') &&
    !svg.includes('<foreignObject') &&
    !svg.includes('<g ')
    && !svg.includes('<g>')
  );
}

async function planDeck({ brief, slides, audience }) {
  const requested = Number(slides);
  const requestedContent =
    Number.isFinite(requested) && requested >= 3 ? Math.max(1, Math.round(requested) - 2) : null;

  const lengthRule = requestedContent
    ? `Produce exactly ${requestedContent} content slides.`
    : 'Choose the number of content slides the brief genuinely needs: a narrow brief may need 3, a broad one may need 10. Do not pad and do not merge distinct ideas.';

  const system = [
    'You are a presentation strategist. Return JSON only.',
    'Schema: {"title": string, "subtitle": string, "slides": [{"title": string, "bullets": [string, string, string]}]}',
    lengthRule,
    'Each slide gets 3 concrete bullets, max 18 words per bullet.',
    'The title is the deck title, the subtitle is one line of context. Write specific, non-generic copy from the brief.',
  ].join('\n');

  const result = await callModel({
    system,
    user: `BRIEF:\n${brief}\n\nAudience: ${audience}\n${
      requestedContent ? `Content slides: ${requestedContent}` : 'Content slides: infer from the scope of the brief'
    }`,
    maxTokens: 1600,
  });

  const plan = result.data ?? {};
  const planned = Array.isArray(plan.slides) ? plan.slides : [];
  const slidesOut = planned
    .map((slide) => ({
      title: String(slide?.title ?? '').trim(),
      bullets: Array.isArray(slide?.bullets)
        ? slide.bullets.map((bullet) => String(bullet).trim()).filter(Boolean).slice(0, 4)
        : [],
    }))
    .filter((slide) => slide.title)
    .slice(0, requestedContent ?? 14);

  if (!slidesOut.length) throw new Error('Planner returned no slides');

  return {
    title: String(plan.title ?? '').trim() || 'Studio deck',
    subtitle: String(plan.subtitle ?? '').trim() || `Prepared for ${audience}`,
    slides: slidesOut,
    provider: result.provider,
    usage: result.usage,
  };
}

async function authorSlide({ plan, slide, role, index, total, audience }) {
  const system = [
    'You are a senior presentation designer. Return JSON only: {"svg": "<complete svg markup>"}.',
    SVG_RULES,
    '',
    `Deck: ${plan.title} - ${plan.subtitle}`,
    `Audience: ${audience}`,
    `Page ${index} of ${total}. Page role: ${role}.`,
    'Design with intent: a clear hierarchy, generous margins, one accent color. Vary the layout between pages.',
    'Section labels and eyebrows must be thematic, never the words cover, content, or closing.',
    'The svg value must be one complete <svg> element and nothing else.',
  ].join('\n');

  const body =
    role === 'cover'
      ? `Cover page.\nTitle: ${plan.title}\nSubtitle: ${plan.subtitle}\nAudience: ${audience}\nFooter text: ${plan.title}`
      : role === 'closing'
        ? `Closing page.\nMain line: Thank you\nSub line: ${plan.subtitle}\nFooter: GTM-360 - Studio`
        : `Content page.\nTitle: ${slide.title}\nBullets:\n${(slide.bullets.length ? slide.bullets : ['Key point']).map((bullet) => `- ${bullet}`).join('\n')}`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await callModel({ system, user: body, maxTokens: 3600 });
    const svg = cleanSvg(result.data?.svg);
    if (validSvg(svg)) return { svg, provider: result.provider, usage: result.usage };
    if (attempt === 2) throw new Error(`Slide ${index} did not return valid SVG`);
  }

  throw new Error(`Slide ${index} failed`);
}

async function runTool(python, scripts, args, cwd, label) {
  try {
    return await run(python, [path.join(scripts, args[0]), ...args.slice(1)], {
      cwd,
      shell: false,
      timeoutMs: 300_000,
    });
  } catch (error) {
    return { stdout: '', stderr: `${label} failed: ${error.message}` };
  }
}

async function newestPptx(dir) {
  let best = null;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.toLowerCase().endsWith('.pptx')) {
        const info = await stat(full).catch(() => null);
        if (info && (!best || info.mtimeMs > best.mtime)) best = { file: full, mtime: info.mtimeMs };
      }
    }
  }

  await walk(dir);
  return best?.file ?? null;
}

async function readQualityReport(project) {
  try {
    const raw = await readFile(path.join(project, 'validation', 'svg_quality_report.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function failingPages(report) {
  if (!report || !Array.isArray(report.files)) return [];
  return report.files
    .filter((file) => Array.isArray(file.errors) && file.errors.length > 0)
    .map((file) => ({
      file: String(file.file).replace(/\.svg$/i, ''),
      errors: file.errors.slice(0, 8).map(String),
    }));
}

export async function runHarness({ repo, project, brief, slides, audience, progress, python }) {
  const scripts = path.join(repo, 'skills', 'ppt-master', 'scripts');
  const svgDir = path.join(project, 'svg_output');
  const providers = new Set();
  const usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const addUsage = (value) => {
    usage.tokensIn += Number(value?.tokens_in ?? 0);
    usage.tokensOut += Number(value?.tokens_out ?? 0);
    usage.costUsd += Number(value?.cost_usd ?? 0);
  };
  let steps = 0;

  await mkdir(svgDir, { recursive: true });

  await progress('planning', 12, 'Planning the deck');
  const plan = await planDeck({ brief, slides, audience });
  providers.add(plan.provider);
  addUsage(plan.usage);

  const contentCount = plan.slides.length;
  const total = contentCount + 2;

  const pages = [
    { role: 'cover', slide: { title: plan.title, bullets: [] } },
    ...plan.slides.map((slide) => ({ role: 'content', slide })),
    { role: 'closing', slide: { title: 'Thank you', bullets: [] } },
  ];

  for (let index = 0; index < pages.length; index += 1) {
    steps += 1;
    const percent = 16 + Math.round((index / pages.length) * 55);
    await progress('authoring', percent, `Authoring slide ${index + 1} of ${pages.length}`);

    const authored = await authorSlide({
      plan,
      slide: pages[index].slide,
      role: pages[index].role,
      index: index + 1,
      total,
      audience,
    });

    providers.add(authored.provider);
    addUsage(authored.usage);
    const name = `P${String(index + 1).padStart(2, '0')}.svg`;
    await writeFile(path.join(svgDir, name), authored.svg, 'utf8');
  }

  await progress('checking', 74, 'Running the ppt-master quality checker');

  const checkerArgs = [
    'svg_quality_checker.py',
    project,
    '--quick-generate',
    '--canonical-authoring',
    '--stage',
    'final',
    '--json',
  ];

  let checker = await runTool(python, scripts, checkerArgs, repo, 'checker');
  let report = await readQualityReport(project);
  steps += 1;

  for (let round = 1; round <= MAX_REPAIR_ROUNDS; round += 1) {
    const broken = failingPages(report);
    if (!broken.length) break;

    await progress('repairing', 78 + round * 3, `Repairing ${broken.length} slide(s)`);

    for (const page of broken) {
      const target = path.join(svgDir, `${page.file}.svg`);
      const current = await readFile(target, 'utf8').catch(() => '');
      if (!current) continue;

      const system = [
        'You repair presentation SVGs. Return JSON only: {"svg": "<complete corrected svg>"}.',
        SVG_RULES,
        '',
        'Fix every listed error. Keep the design intent and copy; change only what the errors require.',
      ].join('\n');

      const result = await callModel({
        system,
        user: `CURRENT SVG:\n${current}\n\nCHECKER ERRORS:\n${page.errors.join('\n')}`,
        maxTokens: 3600,
      });

      const repaired = cleanSvg(result.data?.svg);
      if (validSvg(repaired)) {
        await writeFile(target, repaired, 'utf8');
        providers.add(result.provider);
        addUsage(result.usage);
        steps += 1;
      }
    }

    checker = await runTool(python, scripts, checkerArgs, repo, 'checker');
    report = await readQualityReport(project);
    steps += 1;
  }

  const remaining = failingPages(report);
  if (remaining.length) {
    const detail = remaining.map((page) => `${page.file}: ${page.errors[0] ?? ''}`).join(' | ');
    throw new Error(`Checker still failing - ${detail}`.slice(0, 600));
  }

  if (!report) {
    throw new Error(`Checker produced no report: ${(checker.stderr || checker.stdout).slice(-300)}`);
  }

  await progress('exporting', 90, 'Exporting native PowerPoint');
  const exporter = await runTool(
    python,
    scripts,
    ['svg_to_pptx.py', project, '--quick-generate'],
    repo,
    'exporter',
  );

  const file = await newestPptx(project);
  if (!file) {
    throw new Error(`Export produced no pptx: ${(exporter.stderr || exporter.stdout).slice(-300)}`);
  }

  return {
    file,
    providers: [...providers],
    steps,
    plan,
    total,
    usage,
  };
}
