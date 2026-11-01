import type { Env } from '../env';

export async function dispatchRender(env: Env, jobId: string): Promise<void> {
  const url = `https://api.github.com/repos/${env.STUDIO_REPO}/actions/workflows/${env.STUDIO_WORKFLOW}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gtm360-studio',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: env.STUDIO_BRANCH || 'main',
      inputs: { job_id: jobId },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub dispatch ${response.status}: ${body.slice(0, 300)}`);
  }
}
