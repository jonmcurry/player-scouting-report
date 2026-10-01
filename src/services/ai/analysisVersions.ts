export const ANALYSIS_POLICY_VERSION = "policy-1.1";
export const PROMPT_RENDER_VERSION = "render-1.3";
export const PROMPT_VERSION = `${ANALYSIS_POLICY_VERSION}+${PROMPT_RENDER_VERSION}`;
// No longer the runtime source of truth for analysis_runs.knowledge_version
// as of the methodology knowledge system (supabase/migrations/
// 00029_methodology_knowledge.sql) - analyze.ts now derives that value
// dynamically from the active methodology_versions row via
// loadActiveMethodologySnapshot() (src/services/knowledge/
// methodologyRepository.ts). Kept only because knowledge/claims.json's
// legacy file-backed pack (src/services/knowledge/knowledgePack.ts) still
// references it for its own (now runtime-unused) internal version check.
export const KNOWLEDGE_VERSION = "k-0.1.0";
