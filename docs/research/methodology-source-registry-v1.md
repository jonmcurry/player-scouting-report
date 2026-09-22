# Methodology Source Registry — Research v1

**Status: RESEARCH RECOMMENDATION ONLY.** Nothing here is a database write. No
`methodology_sources` row exists yet from this document; `proposed_trust_status`
is exactly that — a proposal for a human methodology admin to accept, change,
or reject via `/admin/sources.html`. Source approval never implies claim
approval (see `methodology-seed-v1.md`).

Covers the 10 locked seed videos from the 2026-09-21 research task. Titles and
channel names below are **verified independently via YouTube's own oEmbed API**
(`https://www.youtube.com/oembed?url=...`), not trusted from prior Gemini
metadata or from Gemini's own video-content self-report — where those two
disagree, it's called out explicitly per source.

---

## 1. Driveline Baseball

| Field | Value |
|---|---|
| source_id (proposed) | `driveline-baseball` |
| name | Driveline Baseball |
| canonical_url | https://www.youtube.com/@drivelinebaseball |
| source_type | training_org |
| sport_scope | both *(content is baseball-presented; underlying motor-learning/constraint principles are plausibly sport-general, but softball applicability was not itself demonstrated in either video — see per-claim sport_scope, which is `both` on the strength of the mechanism, not because a softball example was shown)* |
| level_scope | teen, advanced, college |
| topic_strengths | timing/load diagnosis, motor-learning coaching philosophy (external vs. internal focus cueing), constraint-based drill design |
| limitations_notes | Training-facility content produced by a commercial performance-training company; some Driveline material elsewhere assumes access to Driveline's own training technology (bat sensors, force plates) not available to an ordinary HitterLoop coach — neither of the two claims extracted here depended on that, but future Driveline material should be checked per-claim. |
| proposed_trust_status | `approved_for_scope` for timing/load coaching heuristics and cueing philosophy, baseball and (cautiously) softball |
| Represented in | Videos 1, 2 |

## 2. TannerTees

| Field | Value |
|---|---|
| source_id (proposed) | `tanner-tees` |
| name | TannerTees (channel), featuring instructor Megan Rembielak |
| canonical_url | https://www.youtube.com/@TannerTees |
| source_type | training_org *(equipment brand's own channel, not an independent publication)* |
| sport_scope | softball |
| level_scope | general |
| topic_strengths | contact-zone/extension drills |
| limitations_notes | Commercial channel selling the "Tanner Tee" product used in the drill — real product-placement influence on drill design. Single instructor, single video; claim not yet cross-checked against another independent source. |
| proposed_trust_status | `candidate` — reasonable single-instructor drill content, but commercial-channel origin means it shouldn't jump straight to `approved_for_scope` without a second opinion. |
| Represented in | Video 3 |

## 3. Blast Motion

| Field | Value |
|---|---|
| source_id (proposed) | `blast-motion` |
| name | Blast Motion |
| canonical_url | https://www.youtube.com/@BlastMotion |
| source_type | training_org *(sensor-hardware/software vendor)* |
| sport_scope | both |
| level_scope | youth, general |
| topic_strengths | swing-plane/posture drill design |
| limitations_notes | **Commercial sensor vendor** — much of Blast Motion's broader content ties claims to its proprietary "Blast metrics" (e.g. on-plane %, bat speed), which ordinary HitterLoop coach video cannot reproduce. The one claim extracted from this specific video is drill/posture-only and was deliberately kept free of sensor-metric numbers (see `weakOrRejectedNotes` in the raw extraction) — but any *future* Blast Motion material must be screened claim-by-claim for metric-dependency before treating it as HitterLoop-observable. |
| proposed_trust_status | `limited` — good for non-metric-dependent drill/cueing content specifically; do not extend blanket approval to this source's metric-based claims. |
| Represented in | Video 4 |

## 4. FloCollege \| Softball

| Field | Value |
|---|---|
| source_id (proposed) | `flocollege-softball` |
| name | FloCollege \| Softball (FloSports network), featuring JT Gasso (Oklahoma Softball hitting coach) |
| canonical_url | https://www.youtube.com/@FloCollegeSoftball |
| source_type | publication |
| sport_scope | softball |
| level_scope | college, advanced |
| topic_strengths | timing-adjustment drill design |
| limitations_notes | **Metadata correction, per the task's own caution:** the actual uploading YouTube channel (verified via oEmbed) is **FloCollege \| Softball**, not "FloSoftball" as prior research apparently reported, and not "Oklahoma Softball" (Gemini's raw extraction mislabeled the channel as "Oklahoma Softball," likely conflating JT Gasso's employer with the actual publisher — the video's real publisher is the FloSports media network, JT Gasso is the featured coach, not the channel owner). Publish date could not be independently confirmed — one secondhand web-search snippet suggested "~December 2017," but that is not a source I can verify directly, so `published_at` should remain `UNKNOWN` until a human confirms it directly on the video page. Content itself is short (~28s of usable instruction per this extraction) — likely a highlight clip rather than the full lesson. |
| proposed_trust_status | `candidate` |
| Represented in | Video 6 |

## 5. American Baseball Coaches Association (ABCA)

| Field | Value |
|---|---|
| source_id (proposed) | `abca` |
| name | American Baseball Coaches Association |
| canonical_url | https://www.youtube.com/@ABCA1945 |
| source_type | association |
| sport_scope | baseball *(ABCA's own scope; do not extend its approval to softball without a softball-specific ABCA-affiliated source)* |
| level_scope | youth, high school, college |
| topic_strengths | youth fundamentals/practice-plan design (Video 8), approach/mental-game coaching philosophy (Video 9) |
| limitations_notes | **Video 8 has an unresolved channel-attribution conflict worth flagging to a human reviewer**: oEmbed (YouTube's own API) confirms ABCA as the publishing channel, but Gemini's video-content extraction reported an on-screen credit of "Golden Spikes Baseball" — possibly a facility/production credit shown in the video itself, not the actual uploader. I did not personally watch the video to resolve this; a human should confirm which entity actually produced/taught the content before treating "ABCA" alone as the full provenance. Video 9's content (Bryson LeBlanc, Missouri) is explicitly approach/mental-game material, not swing mechanics — see the "possible future approach-knowledge domain" flag in `methodology-seed-v1.md`. Also, per the task's caution: the accessible public clip for Video 9 (8tT4KXt5hhk) is confirmed to be excerpted from a much longer (46:43) full ABCA Barnstormers clinic session — only claims supported by the public clip's own content were extracted here. |
| proposed_trust_status | `approved_for_scope` for baseball youth-practice fundamentals (Video 8 content); `candidate` for the approach/mental-game material (Video 9) pending a decision on whether HitterLoop's schema should even carry an approach-knowledge domain yet. |
| Represented in | Videos 8, 9 |

## 6. Let's Have This Conversation

| Field | Value |
|---|---|
| source_id (proposed) | `lets-have-this-conversation` |
| name | Let's Have This Conversation (podcast, host apparently Tevin McChan per Gemini's extraction — not independently verified by me), featuring guest Chad Miller (founder, Louisville Slugger Hitting Science Center) |
| canonical_url | https://www.youtube.com/@letshavethisconversation |
| source_type | publication *(podcast/interview show — explicitly NOT a research or medical publication, confirmed by both my independent oEmbed check and Gemini's own `contentCharacter: "interview/podcast commentary"` classification)* |
| sport_scope | both |
| level_scope | general |
| topic_strengths | biomechanical explanation/interview commentary on kinetic-chain sequencing |
| limitations_notes | **Per the task's explicit caution, this is NOT labeled research-backed or medical/scientific evidence merely because the title contains "science."** It is an interview with a hitting-technology-center founder — his stated numeric claims (8%/11% energy-loss figures on front-foot rollover) are presented in conversation with no on-screen citation of methodology, sample size, or a publication a human could check. Treat as `expert_opinion`/`biomechanical_explanation`, not `research_supported`, until/unless a human finds an actual citable source for those numbers. |
| proposed_trust_status | `limited` — reasonable for qualitative kinetic-chain framing, explicitly NOT for its numeric normative claims without further verification. |
| Represented in | Video 10 |

## 7. Championship Productions (Mike Candrea) — **BLOCKED, not extracted this round**

| Field | Value |
|---|---|
| source_id (proposed) | `championship-productions-candrea` |
| name | Championship Productions, Inc. — "Mike Candrea's Ultimate Coaching Clinic" |
| canonical_url | https://www.youtube.com/@ChampionshipProductions |
| source_type | training_org / publication *(instructional-video production company; NOT USA Softball, per the task's explicit correction — confirmed independently via web search)* |
| sport_scope | softball |
| level_scope | college, advanced, coach-education |
| topic_strengths | practice planning, hitting, infield (per Championship Productions' own listing) — not yet independently verified from actual video content since extraction was blocked. |
| limitations_notes | **Verified via web search, not video content:** this is Championship Productions instructional material *featuring* Mike Candrea, not USA Softball-produced content. Candrea coached Team USA (separately verifiable, e.g. via USA Softball's own Hall of Fame page) — that's fine to note, but do NOT describe him as the *current* all-time NCAA softball wins leader: sources found say he held that record (1,674 wins) at his 2021 retirement, and Carol Hutchins (Michigan) surpassed it in February 2022. A different, lower-quality search snippet claimed 1,859 wins — I could not reconcile that figure with the higher-quality Wikipedia-sourced numbers, so neither figure should appear in any published claim/source note without a human independently confirming it against a primary source (e.g. NCAA or the school's own athletics site). |
| proposed_trust_status | not assessed — no claim content was extracted this round (Gemini API quota exhausted; see `methodology-seed-v1.md` Video 7). |
| Represented in | Video 7 (blocked) |

## 8. Antonelli Softball — **BLOCKED, not extracted this round**

| Field | Value |
|---|---|
| source_id (proposed) | `antonelli-softball` |
| name | Antonelli Softball |
| canonical_url | https://www.youtube.com/@antonellisoftball |
| source_type | educator |
| sport_scope | softball |
| level_scope | not assessed |
| topic_strengths | not assessed — no claim content was extracted this round. |
| limitations_notes | Channel/title verified via oEmbed only ("Behind the Scenes Softball Lesson," channel "Antonelli Softball"); no content-level verification possible this round. |
| proposed_trust_status | not assessed |
| Represented in | Video 5 (blocked) |

---

## Summary

| # | Source | Videos | proposed_trust_status |
|---|---|---|---|
| 1 | Driveline Baseball | 1, 2 | approved_for_scope (timing/load, cueing philosophy) |
| 2 | TannerTees | 3 | candidate |
| 3 | Blast Motion | 4 | limited (non-metric drill content only) |
| 4 | FloCollege \| Softball | 6 | candidate |
| 5 | ABCA | 8, 9 | approved_for_scope (Video 8 youth fundamentals); candidate (Video 9 approach content) |
| 6 | Let's Have This Conversation | 10 | limited (not for numeric claims) |
| 7 | Championship Productions (Candrea) | 7 | not assessed (blocked) |
| 8 | Antonelli Softball | 5 | not assessed (blocked) |

All statuses above are recommendations for a human methodology admin to act on
via `/admin/sources.html` — no `methodology_sources` rows exist from this
document.
