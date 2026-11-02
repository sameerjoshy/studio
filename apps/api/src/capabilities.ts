export type CapabilityStatus = 'live' | 'beta' | 'planned';
export type StudioName = 'Decks' | 'Films' | 'Voices';

export interface Capability {
  id: string;
  studio: StudioName;
  name: string;
  outcome: string;
  bestFor: string[];
  inputs: string[];
  examples: string[];
  estTime: string;
  cost: string;
  licence: string;
  status: CapabilityStatus;
  stages: string[];
  limits: string[];
  disabledReason?: string;
}

/**
 * Single source of truth for the capability catalog.
 * The catalog page, the router prompt, and slash-commands all read from here.
 * Add a capability by appending an entry and shipping a matching runner job.
 */
export const CAPABILITIES: Capability[] = [
  {
    id: 'deck-native',
    studio: 'Decks',
    name: 'Deck Studio',
    outcome: 'A native, editable PowerPoint deck from a brief, a document, or pasted notes.',
    bestFor: [
      'Executive updates and status decks',
      'Turning a document or set of notes into slides',
      'Decks you will keep editing in PowerPoint',
    ],
    inputs: ['Brief or source text', 'Slide count', 'Audience'],
    examples: [
      'Make a 6-slide deck on pipeline hygiene for a B2B sales team',
      'Turn these notes into a 4-slide exec update',
      'Build a 5-slide deck introducing our Deal Room product',
    ],
    estTime: '30-60 seconds',
    cost: 'Free',
    licence: 'MIT (pptxgenjs)',
    status: 'live',
    stages: [
      'Read the brief and infer the audience',
      'Structure the argument into slides',
      'Lay out native title, body, and footer shapes',
      'Export a 16:9 .pptx',
    ],
    limits: [
      'No SmartArt or slide masters yet',
      'Charts and tables are static shapes in this build',
    ],
  },
  {
    id: 'film-brand',
    studio: 'Films',
    name: 'Brand Film',
    outcome: 'A 12-second, on-brand film from a title, a subtitle, and three lines.',
    bestFor: [
      'Product and agent launch clips',
      'Social teasers and end-cards',
      'Repeatable branded motion without an editor',
    ],
    inputs: ['Title', 'Subtitle', 'Three supporting lines', 'Accent colour'],
    examples: [
      'A 12-second brand film for Content Radar',
      'Make a teaser for our Deal Room launch',
      'A short film introducing the Compass OKR product',
    ],
    estTime: '2-4 minutes',
    cost: 'Free (GitHub Actions)',
    licence: 'MIT (HyperFrames renderer)',
    status: 'beta',
    stages: [
      'Write the beat sheet from your brief',
      'Build the HyperFrames composition',
      'Render frames in headless Chrome',
      'Encode H.264 with ffmpeg',
    ],
    limits: [
      '1080p30 only in this build',
      'Expect a 45-60 second runner start before rendering begins',
    ],
  },
  {
    id: 'voice-kokoro',
    studio: 'Voices',
    name: 'Narration',
    outcome: 'Clean narration audio from a script, generated locally on the runner.',
    bestFor: [
      'Voiceover for films and explainers',
      'Drafting narration before a studio recording',
      'Quick audio for slides and docs',
    ],
    inputs: ['Script', 'Voice', 'Speed'],
    examples: [
      'Narrate this script in a warm male voice: ...',
      'Read this in a clear, neutral voice for a product demo',
      'Give me a British female voice for this 60-word script',
    ],
    estTime: '30-90 seconds',
    cost: 'Free',
    licence: 'Kokoro-82M (Apache-2.0)',
    status: 'live',
    stages: [
      'Normalise the script',
      'Synthesise with Kokoro ONNX',
      'Write a 24 kHz WAV',
    ],
    limits: ['English-first voice set', 'No voice cloning in this capability'],
  },
  {
    id: 'voice-xtts',
    studio: 'Voices',
    name: 'Voice Clone',
    outcome: 'Clone a voice from a short reference clip, then narrate with it.',
    bestFor: [
      'Consistent narration across a series',
      'Character and presenter voices',
      'Non-commercial experiments with cloned speech',
    ],
    inputs: ['Script', 'Public reference audio URL (6-30 seconds)', 'Language'],
    examples: [
      'Clone my voice from this clip and read the intro',
      'Narrate this script in the cloned voice at this URL',
    ],
    estTime: '3-8 minutes',
    cost: 'Free',
    licence: 'XTTS v2 (Coqui Public Model License - non-commercial only)',
    status: 'beta',
    stages: [
      'Download and check the reference clip',
      'Extract speaker conditioning',
      'Synthesise the script',
      'Write a WAV',
    ],
    limits: [
      'Non-commercial use only under the model licence',
      'Slow on a 2-vCPU runner',
      'Reference clip must be publicly reachable',
    ],
  },
  {
    id: 'deck-pptmaster',
    studio: 'Decks',
    name: 'PPT Master',
    outcome:
      'Native PowerPoint with slide masters, SVG-authored design, and data-backed charts, driven by the ppt-master workflow.',
    bestFor: [
      'High-design decks from long source documents',
      'Reusing a company .pptx template',
      'Data-backed charts that stay editable',
    ],
    inputs: ['Brief or source text', 'Optional slide count', 'Audience'],
    examples: [
      'Use ppt-master to build a deck on our agent engine',
      'A designed deck from this brief, native and editable',
    ],
    estTime: '5-15 minutes',
    cost: 'Model tokens only (Groq free tier first)',
    licence: 'MIT (hugohe3/ppt-master)',
    status: 'beta',
    stages: [
      'Clone the ppt-master skill on the runner',
      'Harness authors one SVG per slide',
      'Quality checker gates the SVGs',
      'Native DrawingML export to .pptx',
    ],
    limits: [
      'Beta: harness quality varies with the model',
      'Length is inferred from the brief unless you state a count',
      'Falls back to Deck Studio if the harness fails',
    ],
  },
  {
    id: 'film-documentary',
    studio: 'Films',
    name: 'Documentary Cut',
    outcome:
      'A real-footage cut assembled from free archives such as Archive.org, NASA, and Wikimedia Commons.',
    bestFor: [
      'Video essays and mood pieces',
      'Real B-roll instead of animated stills',
      'Stories that need archival texture',
    ],
    inputs: ['Narrative brief', 'Target duration', 'Tone'],
    examples: ['Make a 30-second documentary montage on the history of GTM tools'],
    estTime: '10-30 minutes',
    cost: 'Free (GitHub Actions)',
    licence: 'AGPL-3.0 (OpenMontage)',
    status: 'planned',
    stages: [
      'Build a CLIP-searchable corpus',
      'Select and rank clips',
      'Edit the timeline',
      'Render the final cut',
    ],
    limits: ['AGPL-3.0: modifications must be published if offered as a service'],
    disabledReason:
      'OpenMontage spike pending: it needs a larger runner and a headless check before we ship it.',
  },
];

export const ACTIVE_CAPABILITIES = CAPABILITIES.filter((c) => c.status !== 'planned');

export function getCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}
