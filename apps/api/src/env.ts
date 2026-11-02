export interface Env {
  ASSETS: Fetcher;

  STUDIO_REPO: string;
  STUDIO_WORKFLOW: string;
  STUDIO_BRANCH: string;
  GEMINI_MODEL: string;
  DEEPSEEK_MODEL: string;
  GROQ_MODEL: string;
  STUDIO_BASE_URL: string;

  RUNNER_SECRET: string;
  GITHUB_TOKEN: string;

  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GROQ_API_KEY?: string;
}
