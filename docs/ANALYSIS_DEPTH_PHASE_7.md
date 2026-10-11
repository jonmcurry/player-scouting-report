# Phase 7 local implementation

This phase adds a private, optional instrument path beside the video-led coach and family product. No external provider or first integration was selected because no consented partner export or provider field definitions were supplied. No provider mapping, lab user, or athlete consent was seeded. Phase 8 remains untouched.

## Import contract

`npm run import-instrument-file -- --file <local.csv|json> --player-id <uuid> --consent-id <uuid> --imported-by <uuid> --provider <name> --device-type <bat_sensor|radar|ball_flight|facility_export|other> --device-model <model> --firmware <version>` performs a local dry run. `--commit` stages a verified import through a service-role RPC. A non-local target requires an explicit `--allow-remote` flag and separate release authorization. The importer takes exact source bytes, computes SHA-256, and accepts 1–2,000 readings in a file no larger than 2 MB. Every row needs `record_key`, `field`, `value`, `unit`, and `definition_version`; `device_timestamp` is optional, but must include a timezone when present. JSON also accepts camel-case keys. Unexpected columns/properties are rejected so source data is never silently discarded; each provider field must be converted into its own original reading. CSV quoting, including embedded newlines, is supported. Values stay as source text until an independently reviewed exact mapping is applied. The original file stays with the data owner; the database stores its hash and original fields/units, not the file bytes.

The import requires a recorded, active `private_performance_analysis` consent artifact hash and data-owner label for the same athlete, plus an enabled and trained staff importer on that athlete's team. Import rows and historical interpretations are append-only. Revocation suppresses all instrument reads and new mapping/link work for that consent. Player deletion cascades the staged data and export audit; deletion of a practice session can clear an optional session reference. Real data retention and consent wording require approval before onboarding.

## Mapping, linkage and interpretation

A normalization requires a validated `external_device` measurement definition, independent reviewer, review record, explicit scale/offset, and exact provider, type, model, firmware, provider-definition, source-field, and unit keys. New mapping versions add interpretations; they do not rewrite original readings or old interpretations. A newer firmware or provider definition has no implicit mapping. No mapping was released in this implementation.

Staff select a video attempt manually and record a match reason. The server checks the athlete and an optional practice session, preserves an event history, and clears deleted attempt references. Automatic timestamp synchronization is withheld until a pilot linkage accuracy study confirms it. Neither device data nor manual links generate family findings, scores, or video observations.

## Read, display and export

`performance_lab_access` plus active coach team access gates the separate lab RPCs. Base tables have RLS enabled and no authenticated table grant. The lab appears from Coach analysis only for an enabled staff account; the public demo does not open it. It shows original fields, units, provider-definition version, model/firmware, source hash, import date, warning, and manual link state. Descriptive distributions are grouped by exact mapping ID and appear only after the reviewed minimum sample of at least five readings. The display includes sample count, source, dates, units, definition version, and mapping version. This is a reading distribution, not a swing score or improvement claim.

Export is a permission-checked RPC that hashes and audits its bounded JSON payload before the browser downloads it. The current read/export window is 500 readings per athlete; a larger dataset suppresses distributions and export until scoped selection is designed. Consent revocation prevents future reads and exports; previously downloaded files remain outside the application's control.

## Pilot validation still required

1. Obtain an actual consented partner export, data dictionary, provider version history, and ownership/retention agreement.
2. Compare original files and parsed readings, including unknown fields, units, dates, and file hashes.
3. Independently review the first mapping and verify old/new firmware and provider-definition versions remain distinct.
4. Have staff manually link a pilot sample to original videos and quantify timestamp/link errors before considering automatic sync.
5. Verify authenticated lab access, revocation, deletion, export audit, and mobile rendering against the deployed environment before release.
