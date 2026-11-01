import path from 'node:path';
import PptxGenJS from 'pptxgenjs';

const INK = '0A192F';
const INK_SOFT = '112240';
const ACCENT = '4F46E5';
const PAPER = 'FFFFFF';
const SLATE = '334155';
const MUTED = '64748B';
const LINE = 'E2E8F0';

function addFooter(slide, pptx, page) {
  slide.addText('GTM-360  ·  Studio', {
    x: 0.6,
    y: 6.95,
    w: 5,
    h: 0.3,
    fontSize: 9,
    color: MUTED,
    fontFace: 'Segoe UI',
  });

  if (page !== undefined) {
    slide.addText(String(page), {
      x: 12.1,
      y: 6.95,
      w: 0.6,
      h: 0.3,
      fontSize: 9,
      color: MUTED,
      align: 'right',
      fontFace: 'Segoe UI',
    });
  }
}

export default async function deckNative({ spec, workDir, progress }) {
  const title = String(spec.title ?? 'Untitled deck').trim();
  const subtitle = String(spec.subtitle ?? '').trim();
  const slides = Array.isArray(spec.slides) ? spec.slides : [];

  if (!slides.length) throw new Error('Deck spec has no slides');

  await progress('structuring', 20, `Laying out ${slides.length + 2} slides`);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'GTM-360 Studio';
  pptx.company = 'GTM-360';
  pptx.subject = title;
  pptx.title = title;

  const cover = pptx.addSlide();
  cover.background = { color: INK };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: ACCENT } });
  cover.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.0, w: 1.1, h: 0.09, fill: { color: ACCENT } });

  cover.addText('GTM-360  ·  STUDIO', {
    x: 0.9,
    y: 1.35,
    w: 8,
    h: 0.35,
    fontSize: 11,
    color: '94A3B8',
    charSpacing: 3,
    fontFace: 'Segoe UI',
  });

  cover.addText(title, {
    x: 0.9,
    y: 2.35,
    w: 10.8,
    h: 1.9,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
    breakLine: false,
    fontFace: 'Segoe UI',
    valign: 'top',
  });

  if (subtitle) {
    cover.addText(subtitle, {
      x: 0.9,
      y: 4.35,
      w: 10.2,
      h: 1.1,
      fontSize: 16,
      color: 'CBD5E1',
      fontFace: 'Segoe UI',
    });
  }

  cover.addText(new Date().toISOString().slice(0, 10), {
    x: 0.9,
    y: 6.6,
    w: 4,
    h: 0.3,
    fontSize: 10,
    color: '64748B',
    fontFace: 'Segoe UI',
  });

  slides.forEach((slide, index) => {
    const page = pptx.addSlide();
    page.background = { color: PAPER };
    page.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.12, fill: { color: ACCENT } });

    page.addText(String(slide.title ?? `Slide ${index + 1}`), {
      x: 0.75,
      y: 0.65,
      w: 11.8,
      h: 0.9,
      fontSize: 26,
      bold: true,
      color: INK,
      fontFace: 'Segoe UI',
    });

    const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean) : [];
    if (bullets.length) {
      page.addText(
        bullets.map((bullet) => ({ text: String(bullet), options: { bullet: { code: '2022' } } })),
        {
          x: 0.85,
          y: 1.85,
          w: 11.5,
          h: 4.5,
          fontSize: 15,
          color: SLATE,
          breakLine: true,
          paraSpaceAfter: 10,
          lineSpacingMultiple: 1.15,
          fontFace: 'Segoe UI',
          valign: 'top',
        },
      );
    }

    if (slide.notes) page.addNotes(String(slide.notes));

    page.addShape(pptx.ShapeType.line, {
      x: 0.75,
      y: 6.75,
      w: 11.8,
      h: 0,
      line: { color: LINE, width: 1 },
    });

    addFooter(page, pptx, index + 2);
  });

  const close = pptx.addSlide();
  close.background = { color: INK_SOFT };
  close.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: 7.5, fill: { color: ACCENT } });
  close.addText('Built in Studio', {
    x: 0.9,
    y: 3.0,
    w: 10,
    h: 0.9,
    fontSize: 30,
    bold: true,
    color: 'FFFFFF',
    fontFace: 'Segoe UI',
  });
  close.addText('gtm-360.com', {
    x: 0.9,
    y: 3.95,
    w: 10,
    h: 0.5,
    fontSize: 14,
    color: 'A5B4FC',
    fontFace: 'Segoe UI',
  });

  await progress('rendering', 70, 'Writing the .pptx');

  const out = path.join(workDir, 'deck.pptx');
  await pptx.writeFile({ fileName: out });

  await progress('verifying', 90, 'Deck written');

  return {
    file: out,
    filename: 'deck.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    meta: { engine: 'pptxgenjs', slides: slides.length + 2, title },
  };
}
