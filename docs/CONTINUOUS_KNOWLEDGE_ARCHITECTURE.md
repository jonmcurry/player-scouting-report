# BarrelIQ continuous knowledge architecture

**Status: specification only. Nothing in this document is implemented.** No code, migration,
config or dependency was changed to produce it. Every repo claim below cites a file that was read.
Anything not verified is marked **UNVERIFIED**.

Inputs: `readme.md`, `docs/research/gemini-source-registry.md`,
`docs/research/gemini-cross-source-analysis.md`, `docs/research/gemini-claim-extractions.md`,
and the AI layer (`src/services/ai/*`, `src/cli/analyze.ts`, `src/cli/processUploadQueue.ts`,
migrations 00001, 00003, 00018, 00024, 00025, 00026, `coach/components/compModal.js`,
`coach/components/developmentLogic.js`).

---

## 0. Summary and honest ratings

The goal is right: coaching knowledge should be versioned, reviewable and auditable, and it should
never reach production without a human. But the architecture you sketched is aimed at a lever that
is not the binding constraint. **Three findings change the plan:**

1. **The premise is partly wrong.** AI analysis runs in the Node worker, not the APK. A prompt or
   knowledge change already needs *no APK rebuild*, only a worker restart. What does need a rebuild
   is anything under `coach/`, because Capacitor bundles it (`mobile/capacitor.config.json`:
   `webDir: ../coach`). That is `COMP_BY_CHECKPOINT` in `compModal.js`, `PRIORITY_CATEGORIES` in
   `developmentLogic.js`, and cue text. Knowledge should move out of code for **versioning and
   audit**, not to dodge rebuilds.
2. **The "player context" box in your diagram does not exist.** `analyzeSwing()` receives frame stills
   and one pitch-context string. No age, sport, level, handedness, metrics, analysis quality, active
   priority or history reaches the model, and `players` has no such columns. The prompt hardcodes
   "youth softball (10U)". A knowledge base cannot be applied "by age and sport" when the system does
   not know either.
3. **There is no provenance.** No model, model version, prompt version, knowledge version or
   pipeline version is stored anywhere for an AI output. The Gemini model is hardcoded
   `gemini-1.5-flash` (`geminiAnalyzer.ts:GEMINI_MODEL`); that model is probably retired
   (**UNVERIFIED**, check before any run).

| Idea | Rating | Note |
|---|---|---|
| Analysis policy separated from knowledge, plus provenance | **9/10** | Cheap, independently valuable |
| `no_action_needed`, finding cap, emergency-swing rule | **9/10** | Fixes a prompt that pushes toward manufacturing findings |
| Player-context fields (sport, age band, handedness) | **9/10** | Missing today; prerequisite for everything else |
| Candidate → human-approved pipeline, numeric-claim gate, contradictions as first-class | **8/10** | Correct and worth building, small at first |
| Coach accept / edit / reject analytics | **8/10** | Best evaluation signal you will have; but see §12 (edits are currently lossy) |
| Versioned knowledge in Postgres | **6/10 now** | A version-stamped file in the repo gets most of the value until a second person edits knowledge |
| Automated YouTube → Gemini ingestion | **4/10 now** | Three sample claims, unverified sources. Run it manually, from a CLI, as a trickle |
| Dimensional hitter profiles | **5/10 now** | Right idea, no data to populate it reliably yet |
| Gemini second-opinion QA | **5/10** | Same-vendor blind spots; needs an eval set to know if it helps |
| Generic-feedback detector | **3/10 now** | At one team's volume it reports noise |

You are wrong on one thing worth stating plainly: a larger knowledge base is unlikely to make
BarrelIQ meaningfully better while the measurement is unreliable and there is one team's worth of
data to evaluate against. See §17 for ordering.

---

## 1. Current architecture audit

### 1.1 What exists

| Piece | Where | Behavior |
|---|---|---|
| Prompt | `swingAnalysisShared.ts` `SWING_ANALYSIS_SYSTEM_PROMPT` | A code constant. "10U" and softball hardcoded. Comp bank hardcoded as `SOFTBALL_COMP_BANK` |
| Gemini backend | `geminiAnalyzer.ts` | Frames + pitch string in. Native `responseSchema`. Model string hardcoded `gemini-1.5-flash`. Docstring says never verified against a live key |
| Claude backend | `claudeCliAnalyzer.ts` | Shells out to `claude` CLI, prompt-enforced JSON. Docstring says full path never run end to end; `CHANGELOG.md` 0.12.0 says verified. **Contradictory docs; reconcile** |
| Orchestration | `analyze.ts` `analyzeAndSync` | Writes `checklist_scores`, `issues`, `comp_recommendations`, `comp_notes`, `drill_recommendations` |
| Worker | `processUploadQueue.ts` | Runs the analyzer after a clip is `ready`, in its own try/catch so a failure never fails the clip |
| Coach review | `developmentLogic.js` `issueReviewPatch` | approve / edit / reject; `review_status` in `draft, approved, edited, rejected` |
| Coach protections | `analyze.ts`, `checklistUpsert.ts` | Unreviewed drafts cleared on re-run; reviewed rows never overwritten without `--force`; integration-tested |
| Settings | `app_settings` (00018) | key/value, service-role only. Currently one row (team-creation code) |
| Drills | `drill_library` (00025) | 7 seeded drills, `target_tags`, `age_notes`, `is_active`. No sport scope, no cue, no source link, no versioning |

### 1.2 Gaps that matter for this project

1. **No player context reaches the model** (above). Handedness exists only as the pipeline's 2D
   heuristic `lead_side_guess`, not as a coach-confirmed fact.
2. **No provenance.** `issues.source` and `checklist_scores.source` only say `gemini | pose3d | claude`.
3. **The prompt encourages manufactured findings.** "Rate all 11 checkpoints … plus draft any
   distinct mechanical issues." There is no `no_action_needed`, no cap on findings, and no
   emergency-swing rule. A pitch-context rule already exists ("weigh the outcome against the pitch
   location") but only in the weaker form of a paragraph.
4. **Re-runs collide with versioning.**
   - `analyze.ts` deletes and replaces per-player comps, comp notes and drill recommendations on
     every run. Rerunning with a new knowledge version silently rewrites those with no history.
   - The guard that stops a coach-decided issue reappearing compares **normalized text**
     (`alreadyDecided`). Under a new prompt or knowledge version the model rewords the same finding
     and a previously rejected observation returns as a fresh draft.
5. **Coach edits are lossy.** `issueReviewPatch("edit", …)` spreads `edits` over the row. The AI's
   original wording is overwritten, so "how much did the coach change it" is not recoverable.
6. **Hitter personas do not exist as a classifier.** The closest thing is the six-name softball comp
   bank (Alo, Chamberlain, Chidester, Romero, Watley, McCleney), each with one trait, in both the
   prompt and `compModal.js`. The migration in §9 is additive, not a teardown.
7. **`src/services/reconstruction/*` is unwired** (no importer outside its own tests) and stored
   tilt metrics are unreliable (fixed `WORLD_ROTATION` in `lift_3d.py`). See §17.

### 1.3 Static / dynamic / dangerous

| Stays static in code (reviewed, versioned in git) | Can move to the database (versioned, audited) | Dangerous to make dynamic |
|---|---|---|
| **Analysis policy** (safety and reasoning rules, §8) | Approved coaching claims, cues, applicability | **Analysis policy**: a database edit must not be able to weaken "never invent a flaw" |
| Output JSON schema and enums | Drill library (structured, §3.6) | Schema enums and column constraints |
| Metric definitions and thresholds in `metrics.py`, `analysisQuality.ts` | Knowledge pack selection rules | Anything that decides *whether* a coach-reviewed row may be overwritten |
| RLS policies, coach-review protections | Comp/cue text currently hardcoded in `compModal.js` | Numeric thresholds in the measurement engine |
| Model IDs and defaults (in config, not code constants) | Priority category labels (`PRIORITY_CATEGORIES`) | Publishing a knowledge version without the §14 gates |

Requires a deploy unnecessarily today: hardcoded model string; hardcoded comp bank in `compModal.js`
(APK); hardcoded priority categories (APK); prompt text (worker restart, acceptable, but unversioned).

---

## 2. Risks in the Gemini research

All three research files carry their own "candidate only" banner. That instinct is correct, and this
section shows why. Findings are classified by the treatment they receive.

### 2.1 Contradictory numbers (treatment: `disputed`, no production numeric)

| Topic | File A | File B |
|---|---|---|
| Softball attack angle | `cross-source-analysis` §6: **0° to +8°** | `claim-extractions` limitations: **4° to 12°** |
| Baseball attack angle | `cross-source-analysis` §6: needs **+6° to +14°** (against −6° to −10° pitch descent) | `claim-extractions`: **8° to 18°** |

Two documents from the same research exercise disagree on the number that matters most for the
product's core metric. This is expected, per your brief, and it is the reason numeric claims cannot
be ingested as facts.

### 2.2 Unsupported numeric or causal claims (treatment: `unsupported_numeric_claim` / `unsupported`)

- "Mature athletes produce 20°–35° of separation on 3D motion capture" (§4). No citation.
- "Plate discipline … dictate over 60% of real game outcomes" (§11). No citation, and implausible as stated.
- "Head movement is the single most common cause of high whiff rates in 8U–12U players" (§9). No citation.
- "Forcing young athletes to delay the shoulders often creates lumbar spine hyperextension" (§4). A
  medical claim with no source. **Do not surface to coaches or parents under any circumstances.**
- "Quantified separation angle targets for players under 14" and age cutoffs of 8U–12U vs 13U–18U.
  Presented as fact, not sourced.
- Softball "collegiate 68–72 mph pitching" and the **43-foot distance** as the softball baseline.
  43 ft is the distance for older divisions. I believe 10U fastpitch is played at a shorter distance
  (around 35 ft), which would make the "reaction window" reasoning wrong for the current team.
  **UNVERIFIED.** Confirm against the governing body's published rules for your league.

### 2.3 Evidence-type inflation

Claim 1.1 (internal vs external cueing) is tagged "**Research citation** (Dynamical systems theory &
motor learning literature)" with **High** confidence and no actual citation. This is the claim you
flagged. It also self-contradicts on age: the extraction says it may not apply to novice 8U–10U hitters,
the JSON says `player_level: "teen"`, and the "Finding 1" summary recommends it as validating
BarrelIQ's drill-pairing philosophy for youth. The general motor-learning literature on external focus
exists, but this document neither cites it nor establishes that it holds for youth batting.
Treatment: `disputed / contextual`, `evidence_type = unknown` until a real citation is attached.

### 2.4 Tier and source drift

- Registry (`source-registry`): USA Baseball **Tier A**, ABCA **Tier A**. Decision matrix
  (`claim-extractions`): both **SECONDARY**. Hitting Done Right and Blast Motion are Tier B in one and
  SECONDARY in the other, which is a compatible mapping, but A→SECONDARY is not.
- Two vocabularies (A/B/C and APPROVED CORE / SECONDARY / RESEARCH ONLY) are used for the same
  decision. The matrix says **"APPROVED"**. Nobody approved anything.
- Wasserman/High-Level Throwing: the registry URL is a `google.com/search?q=` redirect with a
  mangled handle (`%2540austinwasserman`), and he appears in neither top-10 list. Treat that entry as
  unverified.
- Source-quality statements ("Gold standard", "Elite", "peer-reviewed", "K-Vest validation") are
  Gemini's characterization. **UNVERIFIED** until a human checks the channel.
- All URLs carry `utm_source=gemini`. These must be stripped and the URL normalized to a video ID.

### 2.5 Sample size and verification

The claim file contains **three** extracted claims from three videos. None of the video titles,
timestamps, or spoken content was verified against the video. Gemini can produce plausible
timestamps for content that is not there. Every claim needs a human to have watched the cited
moment before approval (`verified_against_source`, §3.2).

### 2.6 Coaching philosophy stated as fact

Examples: "Baseball-centric channels … prescribe steep rearward barrel drops that induce pop-ups and
whiffs against fastpitch rise balls" (a causal generalization about a whole population of
instructors); "Older softball clinicians can over-index on slapping"; the Teacherman description as
"dogmatic". These are opinions about sources, not facts about hitting. They are useful as prompts
for a human reviewer and must not be stored as `credibility_notes` without reviewer authorship.

### 2.7 What is genuinely useful

The **structure** is good: shared principle / optional interpretation / disputed / source-specific /
not suitable for production, per checkpoint. That maps directly onto §3's `classification`. The
recurring idea that pitch location and count change mechanics is real, is already half-present in the
prompt, and becomes a hard policy rule in §8. The "system rule" against diagnosing a mechanical flaw
from an emergency swing on an out-of-zone pitch is the single best sentence in the three files.

---

## 3. Candidate-data model

All tables below are **service-role only**, with RLS enabled and **no policies**, the same pattern as
`app_settings` (00018). The coach app and Edge Functions never read them. The worker reads the
*published* pack (§7), and the admin CLI writes candidates. Column types are indicative; enums are
shown as CHECK lists to match the repo's existing migration style.

### 3.1 `knowledge_sources`

```sql
create table knowledge_sources (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  canonical_url            text not null,               -- normalized, no utm_*
  youtube_channel_id       text,                        -- UC… id, resolved by a human, not a handle
  organization_type        text check (organization_type in
                             ('governing_body','research_lab','training_facility','coach','media','equipment_maker','other')),
  sport_scope              text not null check (sport_scope in ('baseball','softball','both')),
  level_scope              text[] not null default '{}', -- e.g. {'youth','high_school'}; free-form is banned
  topics                   text[] not null default '{}', -- taxonomy slugs from §3.3
  -- Gemini's opinion is stored, never trusted:
  gemini_suggested_tier    text,                        -- 'A' | 'B' | 'C' | 'core' | 'secondary' | 'research_only'
  gemini_evidence_claim    text,                        -- e.g. "gold standard" (verbatim, for reviewer context)
  -- Human decisions:
  tier                     text check (tier in ('core','secondary','research_only','rejected')),
  status                   text not null default 'candidate'
                             check (status in ('candidate','approved','paused','rejected')),
  credibility_notes        text not null default '',    -- reviewer-authored
  known_biases             text not null default '',
  age_limitations          text not null default '',
  sport_limitations        text not null default '',
  url_verified_at          timestamptz,                 -- a human confirmed the URL resolves to this source
  last_human_reviewed_at   timestamptz,
  reviewed_by              text,
  last_ingested_at         timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint approved_needs_human check
    (status <> 'approved' or (tier is not null and reviewed_by is not null
                              and last_human_reviewed_at is not null and url_verified_at is not null))
);
```

Seeding rule: the 13 Gemini registry entries load as `status = 'candidate'`, `tier = null`,
`gemini_suggested_tier` filled. The Wasserman row loads with `url_verified_at = null` and cannot be
approved until a human fixes the URL. The two Gemini vocabularies are both stored verbatim, and
neither maps to `tier`.

### 3.2 `knowledge_claims`

```sql
create table knowledge_claims (
  id                     uuid primary key default gen_random_uuid(),
  claim_key              uuid not null default gen_random_uuid(), -- stable across revisions
  revision               int  not null default 1,
  supersedes_claim_id    uuid references knowledge_claims (id),

  source_id              uuid not null references knowledge_sources (id),
  source_video_id        text,                          -- 11-char YouTube id; canonical
  source_video_url       text,                          -- rebuilt from the id; never stored with utm_*
  published_at           timestamptz,
  timestamp_start_s      int,
  timestamp_end_s        int,

  concept                text not null check (concept in (
    'stance_setup','load','stride_plant','hip_shoulder_sequencing','hand_path','barrel_path',
    'contact','extension','head_visual_stability','finish_balance','swing_decision',
    'timing','front_side_stability','posture','barrel_depth','pitch_location_adjustment','game_approach')),

  claim_text             text not null,                 -- OUR paraphrase, not a transcript
  observable_evidence    text not null default '',      -- what would be visible in video

  sport_scope            text not null check (sport_scope in ('baseball','softball','both')),
  age_min                int,                           -- years; null = unspecified. Never inferred.
  age_max                int,
  level_scope            text[] not null default '{}',
  age_guardrail          text check (age_guardrail in
                           ('youth_appropriate','teen_appropriate','advanced_only','requires_physical_screening')),
  applies_when           text not null default '',
  does_not_apply_when    text not null default '',
  coaching_cue           text,

  evidence_type          text not null default 'unknown' check (evidence_type in (
    'research','instrumented_measurement','coaching_experience','video_observation',
    'expert_opinion','analogy','unknown')),
  gemini_confidence      text,                          -- verbatim; NEVER read by approval or promotion logic
  human_confidence       text check (human_confidence in ('high','medium','low')),

  classification         text not null default 'candidate_unclassified' check (classification in (
    'candidate_unclassified','shared_principle','optional_interpretation','disputed',
    'source_specific','unsupported','unsupported_numeric_claim','rejected')),

  is_numeric_normative   boolean not null default false,
  numeric_evidence_kind  text check (numeric_evidence_kind in
                           ('research_citation','instrument_documentation','verified_dataset','human_provenance')),
  numeric_evidence_ref   text,                          -- DOI / doc URL / dataset id / reviewer note

  verified_against_source boolean not null default false, -- a human watched the cited timestamp
  verified_by            text,
  verified_at            timestamptz,

  status                 text not null default 'candidate'
                           check (status in ('candidate','approved','rejected','superseded')),
  review_notes           text not null default '',
  approved_by            text,
  approved_at            timestamptz,
  created_at             timestamptz not null default now()
);
```

Constraints enforced in the database, not just the CLI:

- `status = 'approved'` requires `approved_by`, `approved_at`, `human_confidence`,
  `verified_against_source = true`, and a non-null `age_guardrail`.
- `status = 'approved'` and `classification in ('unsupported','unsupported_numeric_claim','rejected',
  'candidate_unclassified')` is rejected.
- `status = 'approved'` and `is_numeric_normative` requires both `numeric_evidence_kind` and
  `numeric_evidence_ref` (see §3.4).
- A trigger blocks `UPDATE` of any content column on an `approved` row. **Edits create a new
  revision** (`revision + 1`, `supersedes_claim_id`), and the old row becomes `superseded`. This is
  what makes a published knowledge version immutable.
- `gemini_confidence` is a plain text column that no view, function or CLI promotion query may
  select. If a human wants to see it, the review screen displays it labelled "Gemini said".

### 3.3 Concept taxonomy

The 11 checkpoints map to concept slugs; six supporting concepts are allowed, and no others. New
concepts require a code change and review, deliberately.

| Checkpoint slug (existing) | Concept slug |
|---|---|
| stance-setup | `stance_setup` |
| load | `load` |
| stride | `stride_plant` |
| hip-shoulder-sep | `hip_shoulder_sequencing` |
| hand-path | `hand_path` |
| bat-path | `barrel_path` |
| contact-point | `contact` |
| extension | `extension` |
| head-eyes | `head_visual_stability` |
| follow-through | `finish_balance` |
| swing-decisions | `swing_decision` |

Supporting: `timing`, `front_side_stability`, `posture`, `barrel_depth`, `pitch_location_adjustment`,
`game_approach`. The `priority categories` in `developmentLogic.js` (front-side stability, hand path,
timing vs inside pitch, head movement, stride consistency, ball flight, load/timing, balance & finish)
are a *coach-facing* vocabulary and stay separate; a small mapping table links them.

### 3.4 Numeric claims

A claim is `is_numeric_normative` when it states a **target, range, threshold, percentage, or
age cutoff as what a hitter should do or typically does** (for example "+6° to +14° attack angle",
"20°–35° separation", "over 60% of outcomes"). Detection is conservative: any claim whose text
contains a digit next to a unit, `%`, `°`, or an age band is flagged for a human, and the human may
clear the flag. A numeric normative claim can only be approved with one of:

1. `research_citation`: an identifiable paper or report (DOI or full citation), read by the reviewer.
2. `instrument_documentation`: a manufacturer's own definition (for example how a bat sensor defines
   "attack angle" or "on-plane"). This supports a *definition*, not a *target*.
3. `verified_dataset`: a dataset the project can name and re-open.
4. `human_provenance`: an explicit named-reviewer approval with a written provenance note.

Anything else is auto-classified `unsupported_numeric_claim`, cannot become `approved`, and is
excluded from every knowledge pack by construction. Note the important distinction: a **definition**
("attack angle is the bat's vertical direction at contact") can be approved from instrument
documentation. A **norm** ("a good attack angle for softball is X") needs the stronger evidence, and
even then it is a description of a population, not a target for one player.

### 3.5 `knowledge_claim_relationships`

```sql
create table knowledge_claim_relationships (
  id             uuid primary key default gen_random_uuid(),
  claim_a_id     uuid not null references knowledge_claims (id) on delete cascade,
  claim_b_id     uuid not null references knowledge_claims (id) on delete cascade,
  relationship   text not null check (relationship in
                   ('supports','contradicts','qualifies','same_concept','terminology_variant','duplicate')),
  detected_by    text not null check (detected_by in ('gemini','rule','human')),
  review_status  text not null default 'unreviewed' check (review_status in ('unreviewed','confirmed','dismissed')),
  notes          text not null default '',
  check (claim_a_id <> claim_b_id)
);
```

Design rule: **the system does not adjudicate coaching schools.** A `contradicts` edge does not
demote either claim. Its effect is downstream: when a pack contains two claims joined by a confirmed
`contradicts` edge, the renderer emits *one* "coaches disagree on this" entry instead of two
instructions, and the policy layer forbids treating either side as a flaw. This preserves "shared
principle vs disputed interpretation". Add `duplicate` to your list; the research inbox needs it
(§6).

### 3.6 Drills as structured knowledge

Extend `drill_library` (00025) rather than adding a table:

```sql
alter table drill_library
  add column sport_scope         text not null default 'both' check (sport_scope in ('baseball','softball','both')),
  add column age_guardrail       text check (age_guardrail in
                                   ('youth_appropriate','teen_appropriate','advanced_only','requires_physical_screening')),
  add column target_concepts     text[] not null default '{}',   -- taxonomy slugs
  add column setup               text not null default '',
  add column external_cue        text,
  add column success_signal      text not null default '',       -- what the coach should see when it works
  add column common_failure      text not null default '',
  add column when_not_to_use     text not null default '',
  add column source_claim_ids    uuid[] not null default '{}',
  add column status              text not null default 'active' check (status in ('candidate','active','retired')),
  add column knowledge_version_id uuid;                          -- first version that included it
```

Existing `target_tags` (priority categories), `age_notes` and `coach_notes` stay. The seven seeded
drills remain as-is and are treated as coach/owner-authored. Favor **constraint-oriented** drills where
a drill *demonstrably* exposes a fault, but do not encode "external cues are always superior". That
claim (Claim 1.1) is a contextual, candidate-only principle (§2.3). A drill's `external_cue` is a
suggestion, and `internal` cues are not banned.

### 3.7 `knowledge_versions` and membership

```sql
create table knowledge_versions (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,                 -- 'k-2026.10.0'
  status        text not null default 'draft' check (status in ('draft','review','active','retired')),
  notes         text not null default '',
  created_by    text,
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  retired_at    timestamptz,
  promotion_checks jsonb not null default '{}'::jsonb -- §14 gate results, recorded, never inferred
);
create unique index knowledge_versions_one_active on knowledge_versions ((true)) where status = 'active';

create table knowledge_version_claims (
  knowledge_version_id uuid not null references knowledge_versions (id),
  claim_id             uuid not null references knowledge_claims (id),
  primary key (knowledge_version_id, claim_id)
);
create table knowledge_version_drills (
  knowledge_version_id uuid not null references knowledge_versions (id),
  drill_id             uuid not null references drill_library (id),
  primary key (knowledge_version_id, drill_id)
);
```

A trigger makes membership immutable once the version leaves `draft`. Because claims are immutable
once approved (§3.2), a version is a true snapshot.

### 3.8 Provenance and player context (the prerequisites)

**One `analysis_runs` table** instead of six columns on every output table:

```sql
create table analysis_runs (
  id                    uuid primary key default gen_random_uuid(),
  video_clip_id         uuid references video_clips (id) on delete set null,
  player_id             uuid not null references players (id) on delete cascade,
  backend               text not null check (backend in ('gemini','claude','pose3d')),
  ai_model              text not null,               -- as configured, e.g. from env, never a code constant
  ai_model_version      text,                        -- as returned by the API, if the API returns one
  prompt_version        text not null,               -- git-tracked; e.g. 'policy-1.0+render-1.0'
  analysis_policy_version text not null,
  knowledge_version_id  uuid references knowledge_versions (id),   -- null before phase 1
  pipeline_version      text,                        -- pose pipeline / metrics version used as input
  input_manifest        jsonb not null,              -- stills used, metrics used, context fields present/absent
  no_action_needed      boolean not null default false,
  no_action_reason      text,
  created_at            timestamptz not null default now()
);
alter table issues            add column analysis_run_id uuid references analysis_runs (id);
alter table checklist_scores  add column analysis_run_id uuid references analysis_runs (id);
alter table drill_recommendations add column analysis_run_id uuid references analysis_runs (id);
```

`pipeline_version` needs a real source. `PIPELINE_VERSION` currently lives only in the unwired
reconstruction module. The live pipeline has no version stamp, so one must be added to
`metrics.json` (a small change, and a prerequisite for the field being honest).

**Player context**, entered by the coach, never inferred:

```sql
alter table teams   add column sport       text check (sport in ('baseball','softball')),
                    add column level_label text;                 -- e.g. '10U'
alter table players add column age_band    text check (age_band in ('u8','8-10','11-12','13-14','15-18','adult')),
                    add column bats        text check (bats in ('L','R','S')),
                    add column throws      text check (throws in ('L','R'));
```

Privacy choice: **store an age band, not a date of birth.** These are minors. A band is enough to
select age guardrails, and it avoids holding a child's DOB for a product that does not need it.
Unknown stays `null`, and the input manifest records "age band: unknown".

---

## 4. Knowledge lifecycle

```
                Gemini / human proposes
                          │
                          ▼
                     [candidate]  ──(validator: numeric? contradiction? duplicate?)──▶ flags attached
                          │
                human watches the cited timestamp (verified_against_source)
                          │
            ┌─────────────┼───────────────┐
            ▼             ▼               ▼
        [rejected]   [approved]      (edit → new revision → candidate again)
                          │
                 included in a DRAFT knowledge_version
                          │
                 §14 promotion gates
                          ▼
                     [active version]  ──▶  worker renders pack  ──▶ AI
                          │
                 newer claim revision / retired source
                          ▼
                     [superseded]  (old versions keep pointing at the old row)
```

Guarantees: (a) nothing skips `candidate`; (b) approval is a human action recorded with name and
time; (c) an approved claim is immutable, and a change is a new revision; (d) a claim only reaches
production by being a member of the *active* version.

## 5. Source lifecycle

`candidate → approved | rejected`, and `approved → paused → approved`. Approval requires a human to
(1) confirm the channel URL and resolve `youtube_channel_id`, (2) read at least a few videos, and
(3) write `known_biases`, `age_limitations`, `sport_limitations` in their own words. `tier` is set
by the reviewer:

- `core`: claims may be proposed in bulk and reviewed at normal pace.
- `secondary`: claims are useful context; **a `secondary` claim must be corroborated** (a `supports`
  edge from a different source) or human-provenanced before approval.
- `research_only`: claims may be *read* by reviewers but never approved into a pack (Teacherman is
  Gemini's suggested placement; that is the reviewer's call, not ours).
- `rejected`.

A `paused` source is not ingested, and its already-approved claims stay in the versions they were
published in. Pausing does not retroactively edit history; retiring a claim does, through a new
version.

## 6. Approval lifecycle and the research inbox

**Ingestion (admin/server only, never in the coach app).** Suggested CLI verbs in the existing style
(`npm run knowledge -- <verb>`):

| Verb | What it does |
|---|---|
| `sources:import <json>` | Load the Gemini registry as candidates |
| `sources:review <id>` | Record tier/status/notes; requires the fields in §5 |
| `discover <source-id>` | List new video IDs via official APIs only (below). Does not fetch content |
| `extract <video-id>` | Ask Gemini (official video understanding) for structured candidate claims; store as `candidate` |
| `validate` | Rule pass: numeric flags, duplicates, candidate contradictions, age-band sanity |
| `inbox` | Interactive review (below) |
| `version:draft`, `version:review`, `version:activate`, `version:rollback` | §7 and §14 |

**The inbox** shows, per claim: source and tier; video link and timestamp; concept; the claim text;
`observable_evidence`; evidence type; a visible "Gemini said: confidence X" line; sport and age
applicability; related existing claims (same concept); candidate contradictions; numeric flag and
missing-evidence prompt. Actions:

| Action | Effect |
|---|---|
| Approve | Requires the reviewer to tick "I watched the timestamp", set `human_confidence`, `age_guardrail`, and (if numeric) evidence |
| Edit, then approve | Creates a new revision, then approves it |
| Reject | Requires a reason code; row kept for audit |
| Mark disputed | Sets `classification = disputed`; links the contradicting claim |
| Mark duplicate | Adds a `duplicate` edge; keeps the better-worded claim |

A CLI is fine for v1. A web UI would be a *separate admin app* (an authenticated route that is not in
`coach/` and not in the APK), and that is not needed until there are reviewers other than you.

**YouTube/Gemini rules (also §15):** use only Google's documented, supported video-understanding
capability for public YouTube URLs, and the YouTube Data API for discovery. **UNVERIFIED:** current
Gemini API terms, quotas, and the exact preview status of YouTube URL input. Read them before
building `extract`. Do not download, transcode, or rehost creator videos.

## 7. Versioning strategy

- **Knowledge version** = an immutable snapshot of claim revisions + drills (§3.7). Exactly one
  `active` (partial unique index).
- **Policy version** = a constant in code (`ANALYSIS_POLICY_VERSION`), changed only through a
  reviewed PR. It is *not* a database row.
- **Prompt version** = `policy version + render version`. The render version changes when the
  template that formats the knowledge pack changes.
- **Every AI run** records an `analysis_runs` row (§3.8) with all six identifiers, so "why did it say
  that on 3 October" is answerable.
- **Model identifiers come from configuration**, not a code constant, and the run records what was
  actually used.

**Re-run semantics (fixing gaps 1.2-4).** A new knowledge version must never rewrite history:

- `comp_recommendations`, `comp_notes`, `drill_recommendations` stop being wiped by re-runs and instead
  carry `analysis_run_id`. The UI shows the latest run's rows; older runs remain queryable.
- Issue de-duplication moves from normalized text to a **finding key**:
  `(player_id, concept, phase, clip_id)`. A coach-decided finding with that key suppresses a new
  draft of the same key whatever the wording. A *material* change in evidence may still surface (as a
  draft that references the earlier decision), but it must never silently resurrect a rejected one.
- Coach-reviewed rows are never touched by a version change. Old conclusions keep the version they
  were made under.
- "Upgrade" of old drafts to a new version is opt-in, per player, and only for unreviewed drafts.

## 8. Prompt architecture

Three layers, with different owners and change processes:

```
┌───────────────────────────────────────────────────────────────┐
│ 1. ANALYSIS POLICY          code, reviewed PR, git-versioned   │
├───────────────────────────────────────────────────────────────┤
│ 2. KNOWLEDGE PACK           database, human-approved, versioned│
│    rendered for THIS player: sport, age band, concept, context │
├───────────────────────────────────────────────────────────────┤
│ 3. SWING INPUT              stills + measurements + context    │
│    with per-field provenance and explicit "unknown"            │
└───────────────────────────────────────────────────────────────┘
```

### 8.1 Analysis policy (layer 1, static)

Your list, made concrete. The policy states, in order of priority:

1. The original video stills are the source of truth. Pose data, bat tracks, metrics and 3D are
   supporting evidence only. Never conclude from the avatar alone.
2. Never invent a flaw. It is correct to return **no finding**. Silence is not failure (§8.3).
3. **At most 2 findings per swing**, and at most 2 flagged as candidates for a coaching priority.
   (A default; tune with data.)
4. State low confidence as low. A single swing or a single frame is `low` by default.
5. **Style variation is not a flaw.** Stance, stride strategy, finish and hand carriage are
   descriptive unless they are causally tied to an observed outcome across swings.
6. **Emergency-swing rule (§8.4).**
7. Do not state exact joint angles, bat speeds, distances, or normative ranges unless calibrated
   measured data with confidence was supplied. Do not quote numbers from the knowledge pack as
   targets for this athlete.
8. Never make injury, medical or maturation claims.
9. Younger athletes: prefer balance, posture, barrel control, timing, contact quality and simple cues;
   do not prescribe exact separation angles, overspeed work, or anatomical manipulation (§9.2).
10. Coach conclusions are authoritative. Never contradict or re-open a coach-reviewed finding.
11. Distinguish *observed in video* from *suggested by reconstruction* in every finding.

### 8.2 Knowledge pack (layer 2, dynamic)

The worker renders the pack for the run:

1. Load the `active` version's claims.
2. Filter by `sport_scope` (player's sport, or `both`), by `age_guardrail` vs the player's age band,
   and by concept relevance to the located phases and checkpoints. Unknown age band → the most
   conservative subset (`youth_appropriate` only).
3. Include only `shared_principle` (as guidance) and `optional_interpretation` (labelled optional).
   `disputed` claims render as a single "coaches disagree" note. `source_specific`, `unsupported*`,
   `rejected` are never included. `requires_physical_screening` and `advanced_only` never appear for
   youth players.
4. Cap size (initial suggestion: ≤ 12 entries, ≤ ~1,500 tokens) and record which claim IDs were
   included in `analysis_runs.input_manifest`.
5. Each entry is formatted as *principle · applies when · does not apply when · cue*, tagged with its
   claim ID so a finding can cite it.

Unverified assumption to test: that a small, filtered pack outperforms none. This is exactly what the
§13 evaluation exists to answer, and it may turn out to make little difference.

### 8.3 Output schema changes

```jsonc
{
  "noActionNeeded": true|false,
  "noActionReason": "string",            // required when noActionNeeded
  "checklist": [ ... ],                    // may be empty; unscored is honest
  "issues": [                              // 0..2
    { "issue": "...", "concept": "<taxonomy slug>",
      "basis": "video" | "metric" | "reconstruction",
      "contextExplainsIt": true|false,     // pitch location / count already explains this
      "emergencySwingSuspected": true|false,
      "knowledgeClaimIds": ["..."],        // claims relied on; empty is allowed
      "suggestPriority": true|false,
      "confidence": "high|medium|low", ... existing fields ... }
  ]
}
```

`noActionNeeded = true` with an empty `issues` array is a first-class, valid, *displayable* outcome:
"No meaningful mechanical issue is supported by this swing." The prompt must stop implying that every
checkpoint deserves commentary. `comps` becomes optional and off by default (§9.3).

### 8.4 Pitch-context rule (hard, in policy)

> Do not label an adjustment to a clearly poor or chase pitch as a persistent mechanical flaw unless
> the same pattern appears across multiple swings. Use pitch location, count and outcome when
> supplied. Unknown metadata stays unknown; never assume a pitch was a strike or a ball.

This is enforced twice: in the prompt, and in the worker, which passes location/count/outcome from
`at_bat_pitches` in structured form (not only the free-text `pitchContext` string it uses today) and
records what was present in `input_manifest`. A finding with `contextExplainsIt = true` is stored but
not offered as a priority. It is also demoted in coach review.

### 8.5 Two backends, one contract

Gemini has native schema enforcement; the Claude CLI backend is prompt-enforced JSON. Both must be
validated against the *same* runtime schema (a validator on the worker side) so that a malformed
response fails safe (no rows written) instead of partially writing.

## 9. Hitter-profile migration

### 9.1 What exists and what to change

No persona classifier exists; the comp bank is the only "archetype-like" content. **Do not delete it.**
Keep the `comp_recommendations` history and the `compModal.js` cues. Migration steps, all additive:

1. Comps stay readable and stay coach-facing as *illustrations of a cue*, relabelled "an example of
   this idea, not a target". The AI stops selecting comps by default (`comps` optional, §8.3).
2. Add descriptive, append-only observations:

```sql
create table hitter_profile_observations (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players (id) on delete cascade,
  dimension     text not null check (dimension in (
    'stance_strategy','stride_strategy','load_magnitude','posture_tendency','hand_set_tendency',
    'barrel_entry_tendency','timing_strategy','contact_depth_tendency','game_approach')),
  value         text not null,                 -- small controlled vocab per dimension, defined in code
  observed_by   text not null check (observed_by in ('coach','ai_draft')),
  status        text not null default 'draft' check (status in ('draft','confirmed','dismissed')),
  evidence_clip_ids uuid[] not null default '{}',
  observed_at   timestamptz not null default now(),
  analysis_run_id uuid references analysis_runs (id)
);
```

3. **No score, no good/bad.** Observations are descriptive. An AI-suggested observation is a draft
   until confirmed by a coach, like everything else.
4. The comparison basis, in order: the player's own history → the active priority → pitch context →
   robust shared principles. Never "this hitter versus an elite template".

### 9.2 Age and development guardrails

`age_guardrail` on claims and drills (`youth_appropriate`, `teen_appropriate`, `advanced_only`,
`requires_physical_screening`) is a **routing tag, not a biological assertion**. The pack renderer
uses it to *exclude*, never to justify. For younger hitters the policy prefers balance, posture,
barrel control, timing, contact quality and simple cues, and forbids automatically prescribing
separation angles, maximal-bat-speed or overspeed protocols, or anatomical manipulation. The
research's exact cutoffs (8U–12U vs 13U–18U; "under 14") are **not** encoded. If you later adopt
cutoffs, they come from a cited governing-body or research source and live in the claim's provenance.

### 9.3 Baseball vs softball

One engine. `sport_scope` on claims, drills and sources, with sport-specific approved knowledge able
to override general guidance for that sport. Attack-angle numbers are **not** encoded (§2.1). What is
captured instead is the *context that legitimately differs*: pitch trajectory (release/plane), height
and location, reaction window (which depends on pitching distance and speed, **and the pitching
distance for the player's division must be a coach-entered fact, not a hardcoded 43 ft**), pitch type,
and game situation. Add `teams.level_label` (§3.8), and treat pitching distance as optional team
metadata when you want the reaction-window reasoning to be honest.

## 10. QA architecture (Gemini second opinion)

```sql
create table analysis_qa_reviews (
  id                 uuid primary key default gen_random_uuid(),
  video_clip_id      uuid not null references video_clips (id) on delete cascade,
  analysis_run_id    uuid not null references analysis_runs (id) on delete cascade,
  reviewer_model     text not null,
  reviewer_model_version text,
  qa_prompt_version  text not null,
  result             jsonb not null,   -- per-check: pass | warn | fail | unknown, with a short reason
  max_severity       text not null check (max_severity in ('none','info','warn','critical')),
  warnings           text[] not null default '{}',
  created_at         timestamptz not null default now()
);
```

Checks: correct athlete tracked; phases plausible; bat tracking obviously broken; each finding
supported by what is visible; finding is generic; confidence too strong; an important visible issue
missed.

Design rules:

- **Advisory and stored separately.** It never edits, replaces or deletes an analysis, and coaches do
  not see it in v1. It feeds §13 and internal triage.
- **Different model family from the analyzer, at least while evaluating.** If Gemini analyzes and
  Gemini reviews, shared blind spots pass each other. Using a second vendor for QA during evaluation
  is the cheap way to find out whether QA adds signal. I rate the feature 5/10 until that is measured.
- **Privacy is different here.** Analysis today sends *frame stills*. QA needing "original swing
  video + overlay" sends *more* youth video to a third party. That needs an explicit data-handling
  decision (§14) before it is built.
- A `critical` QA severity **blocks knowledge-version promotion** if it appears in an evaluation run
  (§14), but never blocks a coach.

## 11. Generic-feedback analytics

Goal: notice when BarrelIQ says the same thing regardless of evidence. It must not force variety;
repeated feedback is fine when the evidence repeats.

- **Unit:** `(concept, finding key)` from `issues`, plus drill and cue frequency.
- **Windows:** rolling 30/90 days, segmented by sport, age band, game vs practice, and player, **only
  when `n` per segment ≥ a floor (start at 30 findings; below it, report nothing)**.
- **Signals for "suspicious":** (1) one concept's share of all findings is high *and* its coach
  acceptance rate is low; (2) near-identical text across *unrelated* players; (3) the same drill
  recommended irrespective of concept; (4) a finding repeating for a player whose measured phases
  show no corresponding change. Signal (1) and (2) are computable from existing tables; (4) needs
  metrics per finding.
- **Output:** a weekly report row per segment, for you, never a runtime constraint on the model. The
  model is not told to be less repetitive. That would produce invented variety.
- **Rating: 3/10 now.** One real team and a handful of clips will not clear the sample floor.
  Build the columns that make it possible (§3.8, `finding key`, `concept`) and defer the job.

## 12. Coach-feedback analytics

Reuse `issues.review_status` (`approved / edited / rejected`). Additions:

```sql
alter table issues
  add column rejection_reason text check (rejection_reason in
    ('incorrect','unsupported','not_important','wrong_context','bad_drill','duplicate','other')),
  add column ai_original      jsonb;   -- snapshot of the AI's fields at first coach touch
```

- `rejection_reason` is **optional**, never mandatory.
- **`ai_original` is required, not optional.** Today an Edit overwrites the row (§1.2-5), so acceptance
  is measurable but *how much* a coach changed is not. Snapshot before the first edit, and it also
  makes rejected/edited findings evaluable later.
- Acceptance rate, computed by: checkpoint/concept, `ai_model`, `prompt_version`, `knowledge_version`,
  `confidence`, sport, age band, game vs practice. Same sample-size floor as §11.
- **Confidence calibration:** the fraction approved among `high` vs `medium` vs `low` findings. If
  `high` is not approved more often than `low`, the confidence field is decoration.
- Caveat to state in the UI and docs: approval is coach *agreement*, not truth. A coach can approve a
  wrong finding. Treat it as a useful signal with known bias (deference to a confident draft).

## 13. Evaluation framework

**Reality check first:** there is one real team and a small clip count, so any regression result today
is anecdotal. The framework should be *designed* now and *trusted* later. Minimum before a
promotion decision leans on it: on the order of tens of coach-labelled swings across at least two
teams, both sports if you intend to serve both, and both handedness. Stated as a judgment, not a
statistical claim.

- **Private set.** Video and derived data live outside git, following the existing pattern
  (`videos/*`, `frames/*`, `validation/*manifest*.json` are gitignored, and
  `validation/validation-manifest.example.json` is committed as a shape example only). The repo is
  **public**: no youth video, frames, names, or identifying metadata may be committed.
- **Coverage targets:** softball/baseball, R/L/switch, age bands, game/practice, camera angles, pitch
  contexts, body types, swing styles. Track coverage in the manifest; report gaps.
- **Labels come from coaches** (approved/edited/rejected and, where feasible, a "missed finding" list),
  not from Gemini.
- **Comparison:** run `(old policy + old knowledge)` vs `(new policy + new knowledge)` over the same
  swings; for each, compute: coach acceptance; unsupported-claim rate (findings whose `basis` is not
  supported by stills, judged by a human on a sample); missed-finding rate; generic-feedback rate
  (§11); drill relevance; confidence calibration; and **no-action rate** (a jump to near-zero *or* near-
  100% is a red flag).
- **Determinism:** fix the model version, temperature and seed where the API allows, and run each
  config more than once to estimate run-to-run variance. Without that, differences are noise.
- Output: a run row stored in the version's `promotion_checks` (§14).

## 14. Production promotion and rollback

A knowledge version becomes `active` only if all of these are recorded in `promotion_checks`:

1. **Candidate review complete:** no member claim is unreviewed; every numeric normative claim has
   evidence; no `disputed` claim is rendered as an instruction.
2. **Regression evaluation complete** (§13) against the current active version, results attached.
3. **No critical QA regression** (§10) in the evaluation run.
4. **Human approval:** a named person, timestamped.

Ingestion finishing, or a high Gemini confidence, never satisfies any of these. Activation is a single
transaction: the previous `active` becomes `retired`, the new one `active`.

**Rollback** is `version:rollback`: re-activate the previous version (its membership is immutable, so
it is exactly what ran before). Never delete a version or a claim. New analyses use the restored
version immediately, and existing coach-reviewed content is unaffected because it was never
rewritten. A `retired` version stays referenceable by every historical `analysis_runs` row. A
rollback of *policy* is a git revert plus a worker deploy.

## 15. Security, privacy and copyright

**Security / privacy**

- All knowledge tables: RLS on, **no policies**, service-role only (§3). Not exposed to the coach app
  or to `get-player-report`.
- The public share-link report must remain a whitelist of coach-confirmed content
  (`supabase/functions/get-player-report/shape.ts`). Knowledge claims, claim IDs, QA results and
  provenance must not leak into it.
- **Minors' data:** age band, not DOB (§3.8). No player name, photo or video is sent to any new service
  without a written data-handling decision. Today Gemini receives extracted stills; QA (§10) and any
  video-level analysis would widen that. Review the provider's data-use/retention terms for your API
  tier (**UNVERIFIED**: I have not checked them).
- Secrets: the Gemini key stays server-side (`.env`, worker). It appeared in plaintext chat once
  already, per `geminiAnalyzer.ts`'s docstring; rotate it if it was ever live.
- Prompt-injection surface: claim text and video-derived summaries are **data, not instructions**.
  The renderer must quote them as data, strip control-like content, and the policy layer states that
  pack content cannot alter policy.
- `claude-cli` is local-testing only and must never be enabled in a deployment (existing rule).

**Copyright / platform terms**

- Store URLs, video IDs, timestamps, **our own** summaries and structured claims. Never store
  transcripts, captions, or the creator's wording beyond short quotations needed for attribution.
- Do not download, transcode or rehost creator videos. Do not scrape YouTube. Use official APIs and
  the supported Gemini video capability only. **UNVERIFIED:** current YouTube API and Gemini terms and
  quotas. Read them before `discover`/`extract` are written.
- Attribute in provenance (`source_id`, `source_video_url`, `timestamp`). A knowledge pack fed to the
  model contains paraphrase and cues, not creator scripts.
- Commercial-source note: several suggested sources are businesses that sell training. Their claims
  can be reasonable *and* commercially motivated. `known_biases` exists for the reviewer to say so.

## 16. Rollback and failure handling (summary)

| Failure | Response |
|---|---|
| A bad claim shipped | New version without it, or `version:rollback`. Coach content untouched |
| A bad prompt/policy change | git revert + worker deploy. Runs already recorded keep their `prompt_version` |
| Gemini returns malformed JSON | Worker-side schema validation fails the *diagnosis only*; the clip stays `ready` (existing behavior) and no partial rows are written |
| Gemini model retired | Model ID comes from config, and `analysis_runs.ai_model` records what actually ran. A failed run is logged, not silently substituted |
| Ingestion produces junk | It only ever creates `candidate` rows. Nothing is user-visible |

## 17. Phased implementation plan

Ordering principle: **fix inputs and safety before adding knowledge**, and **gate each phase on data,
not on enthusiasm.**

### Phase 0: Foundations (BUILD NOW; days, not weeks)

1. Player-context fields (§3.8): `teams.sport`, `teams.level_label`, `players.age_band/bats/throws`,
   and coach UI to set them. Pass them into the prompt with explicit "unknown".
2. `analysis_runs` + `analysis_run_id` on outputs; model IDs from config; add a real
   `pipeline_version` to `metrics.json`.
3. Policy/schema fixes: `noActionNeeded`, ≤ 2 findings, emergency-swing rule, `contextExplainsIt`,
   structured pitch context from `at_bat_pitches`, worker-side response validation for both backends.
4. `issues.ai_original` snapshot and optional `rejection_reason`.
5. Replace text-based dedupe with the finding key; stop wiping comps/drills per run.
6. Reconcile stale docs (`claudeCliAnalyzer.ts` docstring vs changelog; Dockerfile/compose still
   mentioning removed `reports/`), and replace the hardcoded `gemini-1.5-flash`.

Exit: a swing analyzed today produces an `analysis_runs` row; a fine swing can return "no action";
nothing about existing coach-reviewed data changed.

### Phase 1: Small manual knowledge base (BUILD NOW, small)

- Tables in §3.1-3.7, service-role only, with the constraints.
- CLI: `sources:import`, `sources:review`, `inbox`, `version:*`. No Gemini call yet.
- **Start with a version-controlled file** (`knowledge/claims.json`, reviewed by PR) if you want the
  cheapest possible start: same schema, same constraints enforced by a validator, and the database
  becomes the store only when a second editor or a runtime need appears. Rating: 6/10 for the
  database now, 8/10 for the file now.
- Hand-verify ≤ 30 claims from the 5-6 sources you personally trust most, prioritizing sources aimed
  at your actual population (youth fastpitch). Numeric gate on from day one.

Exit: a pack renders for a 10U softball player, shows in `input_manifest`, and a coach-reviewed
finding is provably unaffected by version changes.

### Phase 2: Feedback analytics (BUILD NOW-ish)

Acceptance by concept / model / prompt / knowledge version / confidence, calibration table. A SQL view
or a script, not a dashboard.

### Phase 3: Evaluation set + regression harness (BUILD LATER; gated on data)

Requires more than one team and enough coach-labelled swings. Starts as a manifest and a script.

### Phase 4: Gemini ingestion, QA, generic-feedback, hitter profiles (BUILD LATER; gated on Phase 3)

Each is only worth building once Phase 3 can tell whether it helped. Ingestion begins as a manual
trickle (a few videos a week), not a scheduled crawler.

### Phase 5: Promotion workflow (BUILD LATER; design the version pointer in Phase 1)

Automated gate checks, activation transaction, rollback command. Until then, promotion is manual and
recorded.

### Measurement debt: before or alongside (your §25)

These are real limitations and **a larger knowledge base does not fix any of them**:

| Debt | Recommendation |
|---|---|
| Stored tilt metrics unreliable (fixed `WORLD_ROTATION`) | **Before** any finding may rely on tilt: stop showing them as reliable, or exclude them from the AI input manifest. The viewer's display-only "auto-level" is not a fix to stored values. Track separately |
| `src/services/reconstruction/*` unwired; foot-plant correction inactive | **Alongside:** decide once: wire it into the worker with a validation run, or stop describing it as active in `docs/PIPELINE_AUDIT.md` and the changelog. Do not let the knowledge system cite "reconstruction suggests" claims until the reconstruction path is what the docs say it is |
| One real team | **The binding constraint.** It limits §11-§13 more than any missing table. More teams and more coaches labelling will improve the product more than more claims. Prioritize onboarding a second team |
| No calibration, 10U-specific footage | Keep the existing honesty rules (no mph, no degrees-of-truth). The policy layer repeats them |

Rule: the AI input manifest lists which measurements were supplied and their quality
(`analysis_quality`); a finding whose `basis` is `reconstruction` is capped at `medium` confidence
until the measurement path is validated.

## 18. What NOT to build

- **Auto-publishing anything.** No path from ingestion to a coach-visible or model-visible change
  without a human, the §14 gates, and an activated version.
- **YouTube → Gemini → production.** Explicitly rejected.
- Gemini confidence (or any model self-report) as a gate, filter, or tiebreaker.
- Scraping YouTube, downloading or rehosting creator videos, or storing transcripts.
- Research/ingestion tooling inside `coach/` or the APK. Admin CLI or a separate admin app only.
- A "which coaching school is correct" resolver. Preserve disagreement; render it as disagreement.
- Permanent hitter-type labels (power / contact / slap) or an elite-hitter template as the yardstick.
- Universal numeric targets (attack angle, separation, launch angle) or age cutoffs presented as fact.
- Any medical, injury or maturation claim (for example the "lumbar hyperextension" line).
- Drill-causation language. Use "associated with coach-confirmed improvement" only, and only when
  the practice-then-game record supports even that.
- Forced variety in AI output. Repetition is legitimate when the evidence repeats.
- A coach-facing knowledge browser. Coaches see findings and drills, not the research inbox.
- A scheduled crawler, before a manual trickle has shown the extraction quality is acceptable.

## 19. Definition of done

A phase is done only when its **evidence** exists, not when the code merges.

| Phase | Done when |
|---|---|
| **0** | Every new AI output row has an `analysis_runs` row with all identifiers; sport/age band/handedness reach the prompt or are recorded as "unknown"; a clean swing returns `noActionNeeded` with a reason and shows in the UI; a rejected finding does not reappear after a reworded re-run (test); coach-reviewed data provably unchanged (existing integration tests still pass, plus new ones) |
| **1** | No approved claim can violate §3.2 constraints (tests attempt each violation); numeric normative claim without evidence cannot be approved (test); a pack renders per sport/age band and excludes `disputed`/`advanced_only` for youth (tests); rollback restores the exact prior pack (test); knowledge tables unreachable with an `authenticated` or `anon` key (RLS test, same style as the existing 00017 check) |
| **2** | Acceptance-by-version query returns results, with the sample-size floor enforced |
| **3** | A run compares two configs over the same private set with variance estimated, and its output is attached to a version |
| **4** | Each feature has a measured effect against the Phase 3 baseline, or is removed |
| **5** | Activation requires all four §14 checks; activation and rollback tested end to end |

Global: nothing in this document is considered adopted until the corresponding phase's evidence
exists; no research claim is production guidance until it is an approved, immutable, versioned row
that a named human verified against its source.

---

## Recommendation

**BUILD NOW**
- Player context: sport, age band, handedness, entered by the coach (Phase 0).
- Provenance: `analysis_runs`, model/prompt/policy/knowledge/pipeline versions (Phase 0).
- Analysis-policy fixes: `noActionNeeded`, ≤ 2 findings, the emergency-swing rule, structured pitch context, worker-side schema validation (Phase 0).
- Lossless coach feedback: `ai_original`, optional `rejection_reason`, finding-key dedupe (Phase 0).
- A small, human-verified, version-controlled knowledge set (≤ 30 claims) with the numeric-claim gate (Phase 1).
- Acceptance analytics by version and confidence (Phase 2).
- Decide the fate of the unwired reconstruction module, and stop presenting stored tilt as reliable.

**BUILD LATER**
- Postgres-backed knowledge tables beyond the small set, once a second editor or runtime need exists.
- The evaluation set and regression harness, once a second team exists.
- Gemini/YouTube extraction as a manual trickle, and only after Phase 3.
- Gemini QA (with a different model family), dimensional hitter profiles, the generic-feedback job, and an automated promotion workflow.

**DO NOT BUILD**
- Any automatic path from a video or a Gemini output to production guidance.
- Any use of Gemini confidence to approve, rank or promote.
- Scraping or rehosting YouTube content.
- Universal numeric attack-angle, separation or age-cutoff rules.
- Permanent hitter personas, or an elite-hitter template as the standard.
- Medical or maturation claims, and drill-causation claims.
- Knowledge tooling in the coach app or APK.
- A crawler before a manual pipeline has proven the extraction quality.
