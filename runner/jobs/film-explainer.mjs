import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fitAspect } from '../lib/aspect.mjs';
import { callModel } from '../lib/model.mjs';
import { run } from '../lib/shell.mjs';

const REPO = 'https://github.com/calesthio/OpenMontage.git';
const THEMES = new Set([
  'clean-professional',
  'flat-motion-graphics',
  'minimalist-diagram',
  'anime-ghibli',
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function rows(value, limit = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const item = row && typeof row === 'object' ? row : {};
      const label = text(item.label);
      const number = Number(item.value);
      if (!label || !Number.isFinite(number)) return null;
      return {
        label,
        value: number,
        ...(Number.isFinite(Number(item.change)) ? { change: Number(item.change) } : {}),
        ...(item.suffix ? { suffix: text(item.suffix) } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function normaliseCut(raw) {
  const type = text(raw?.type);
  const base = {
    source: '',
    type,
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
  };

  if (type === 'hero_title') {
    const value = text(raw.text);
    return value ? { ...base, text: value, subtitle: text(raw.subtitle) } : null;
  }

  if (type === 'text_card') {
    const value = text(raw.text);
    return value ? { ...base, text: value, subtitle: text(raw.subtitle) } : null;
  }

  if (type === 'callout') {
    const value = text(raw.text);
    return value
      ? {
          ...base,
          title: text(raw.title),
          text: value,
          callout_type: ['tip', 'warning', 'insight'].includes(raw.callout_type)
            ? raw.callout_type
            : 'tip',
          accentColor: '#22D3EE',
        }
      : null;
  }

  if (type === 'stat_card') {
    const stat = text(raw.stat);
    return stat ? { ...base, stat, subtitle: text(raw.subtitle), accentColor: '#22D3EE' } : null;
  }

  if (type === 'comparison') {
    const leftLabel = text(raw.leftLabel);
    const rightLabel = text(raw.rightLabel);
    const leftValue = text(String(raw.leftValue ?? ''));
    const rightValue = text(String(raw.rightValue ?? ''));
    return leftLabel && rightLabel && leftValue && rightValue
      ? {
          ...base,
          title: text(raw.title),
          leftLabel,
          leftValue,
          rightLabel,
          rightValue,
          accentColor: '#A78BFA',
        }
      : null;
  }

  if (type === 'bar_chart' || type === 'pie_chart' || type === 'kpi_grid') {
    const chartData = rows(raw.chartData);
    if (chartData.length < 2) return null;
    return {
      ...base,
      type,
      title: text(raw.title),
      chartData,
      chartColors: ['#22D3EE', '#A78BFA', '#F59E0B', '#34D399', '#FB7185', '#60A5FA'],
      ...(type === 'bar_chart' ? { showGrid: true, showValues: true } : {}),
      ...(type === 'pie_chart' ? { donut: true, showLegend: true } : {}),
      ...(type === 'kpi_grid' ? { columns: Math.min(4, chartData.length) } : {}),
    };
  }

  if (type === 'progress_bar') {
    const progress = Number(raw.progress);
    if (!Number.isFinite(progress)) return null;
    return {
      ...base,
      title: text(raw.title),
      progress: clamp(progress > 1 ? progress / 100 : progress, 0, 1),
      progressLabel: text(raw.progressLabel || raw.subtitle),
      progressColor: '#34D399',
    };
  }

  return null;
}

export default async function filmExplainer({ job, spec, workDir, progress, root }) {
  const brief = String(spec.brief ?? '').trim();
  const seconds = clamp(Number(spec.seconds) || 30, 12, 90);
  const audience = String(spec.audience ?? 'business audience');

  if (!brief) throw new Error('No brief supplied');

  const providers = [];
  let costUsd = 0;

  await progress('planning', 8, 'Planning the explainer');

  const planned = await callModel({
    system: [
      'You design animated explainer videos. Return JSON only.',
      'Schema: {"title": string, "subtitle": string, "theme": string, "cuts": [ ... ]}',
      'Allowed cut types and fields:',
      '- {"type":"hero_title","text":string,"subtitle":string}',
      '- {"type":"text_card","text":string,"subtitle":string}',
      '- {"type":"callout","title":string,"text":string,"callout_type":"tip|warning|insight"}',
      '- {"type":"stat_card","stat":string,"subtitle":string}',
      '- {"type":"comparison","title":string,"leftLabel":string,"leftValue":string,"rightLabel":string,"rightValue":string}',
      '- {"type":"bar_chart","title":string,"chartData":[{"label":string,"value":number}]}',
      '- {"type":"pie_chart","title":string,"chartData":[{"label":string,"value":number}]}',
      '- {"type":"kpi_grid","title":string,"chartData":[{"label":string,"value":number,"change":number,"suffix":string}]}',
      '- {"type":"progress_bar","title":string,"progress":number,"progressLabel":string}',
      'Rules:',
      '- 5-8 cuts. Start with hero_title. End with text_card or callout.',
      '- theme is one of: clean-professional, flat-motion-graphics, minimalist-diagram, anime-ghibli.',
      '- Write specific copy from the brief. No lorem ipsum, no placeholders.',
      '- Only use numbers stated in the brief. If the brief has no numbers, use comparison/progress/text cards instead of charts.',
      '- Keep titles under 10 words and body text under 22 words.',
    ].join('\n'),
    user: `BRIEF:\n${brief}\n\nAudience: ${audience}\nTarget duration: ${seconds} seconds`,
    maxTokens: 1800,
  });

  providers.push(planned.provider);
  costUsd += Number(planned.usage?.cost_usd ?? 0);

  const rawCuts = Array.isArray(planned.data?.cuts) ? planned.data.cuts : [];
  const cuts = rawCuts.map(normaliseCut).filter(Boolean);

  if (cuts.length < 3) throw new Error('The planner returned too few valid scenes');

  const perCut = clamp(seconds / cuts.length, 3, 6);

  cuts.forEach((cut, index) => {
    cut.id = `cut-${String(index).padStart(2, '0')}`;
    cut.in_seconds = Number((index * perCut).toFixed(2));
    cut.out_seconds = Number(((index + 1) * perCut).toFixed(2));
  });

  const requestedTheme = String(spec.theme || planned.data?.theme || '');
  const theme = THEMES.has(requestedTheme) ? requestedTheme : 'flat-motion-graphics';

  const props = {
    theme,
    cuts,
    overlays: [],
    captions: [],
    audio: {},
  };

  const propsPath = path.join(workDir, 'props.json');
  await writeFile(propsPath, JSON.stringify(props, null, 2), 'utf8');

  const repo = process.env.OPENMONTAGE_REPO_DIR || path.join(workDir, 'OpenMontage');
  if (!process.env.OPENMONTAGE_REPO_DIR) {
    await progress('cloning', 16, 'Fetching OpenMontage');
    await run('git', ['clone', '--depth', '1', REPO, repo], { cwd: workDir, shell: false });
  }

  const composer = path.join(repo, 'remotion-composer');

  try {
    await access(path.join(composer, 'node_modules'));
  } catch {
    await progress('installing', 30, 'Installing Remotion (first run only)');
    await run('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: composer,
      timeoutMs: 1_200_000,
    });
  }

  await progress('rendering', 70, `Rendering ${cuts.length} scenes`);

  const out = path.join(workDir, 'explainer.mp4');

  await run(
    'npx',
    [
      '--yes',
      'remotion',
      'render',
      'src/index.tsx',
      'Explainer',
      out,
      '--props',
      propsPath,
      '--codec',
      'h264',
    ],
    {
      cwd: composer,
      timeoutMs: 1_200_000,
      onStdout: (line) => console.log(line.trim()),
      onStderr: (line) => console.log(line.trim()),
    },
  );

  const aspect = ['9:16', '1:1'].includes(String(spec.aspect)) ? String(spec.aspect) : '16:9';
  const formatted = await fitAspect(out, aspect, workDir, 'pad');

  await progress('finalising', 95, 'Explainer rendered');

  return {
    file: formatted,
    filename: 'explainer.mp4',
    contentType: 'video/mp4',
    meta: {
      engine: 'OpenMontage / Remotion',
      title: text(planned.data?.title, 'Explainer'),
      theme,
      scenes: cuts.length,
      duration: Number((cuts.length * perCut).toFixed(2)),
      providers: [...new Set(providers)],
      cost_usd: costUsd,
    },
  };
}
