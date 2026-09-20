# UX Phase 1A verification

## Contrast

Verified by `npm run test:contrast` using the WCAG relative-luminance formula.

| Pair | Ratio | Required |
|---|---:|---:|
| `--text-1` / `--bg` | 16.14:1 | 4.5:1 |
| `--text-2` / `--surface-1` | 8.31:1 | 4.5:1 |
| `--text-3` / `--surface-1` | 5.59:1 | 4.5:1 |
| `--on-brand` / `--brand-fill` | 5.06:1 | 4.5:1 |
| `--brand-text` / `--bg` | 6.35:1 | 4.5:1 |
| `--brand-text` / `--surface-1` | 5.76:1 | 4.5:1 |
| `--success` / `--surface-1` | 8.69:1 | 4.5:1 |
| `--warning` / `--surface-1` | 9.34:1 | 4.5:1 |
| `--danger` / `--surface-1` | 4.51:1 | 4.5:1 |
| white / `--danger-fill` | 4.87:1 | 4.5:1 |
| `--border-strong` / `--surface-1` | 3.47:1 | 3:1 |

The proposed `--border-strong: rgba(244,239,234,0.20)` produced only 1.82:1 on
`--surface-1`. It was minimally adjusted to `0.40` alpha so meaningful input and component
boundaries exceed 3:1. Decorative hairlines retain the quieter `--border` token.

## Font/offline audit

`coach/coach.css` still loads Inter, Oswald and JetBrains Mono from Google Fonts. Their Google
Fonts distributions use the OFL, but this repository has no pinned font-binary/subsetting update
workflow. Phase 1A therefore did not guess at specific binaries or silently add an unmanaged font
copy. System fallbacks remain available offline. The existing `esm.sh` behavior is unchanged as
required.

## Native dialog inventory after Phase 1A

Pitch deletion in `atbat.html` is the representative destructive flow migrated to ConfirmDialog.
Twenty native calls remain for later screen phases:

- `player.html`: 15 calls — player deletion, share-link create/revoke, clip retry/delete, at-bat
  deletion, upload errors, and legacy Log AB validation/errors.
- `session.html`: 1 call — delete repetition.
- `components/compModal.js`: 2 calls — 3D loading errors.
- `components/devActions.js`: 1 call — resolve-priority confirmation.
- `components/stepper.js`: 1 call — score-save error.

No partially migrated operation is left behind; each remaining call retains its prior behavior.

## Staged deviations

- The `Upload swing` ActionSheet row is deferred because the current model requires a safe pitch
  or practice-repetition owner. Inventing an unassigned upload would change domain semantics.
- Runtime fonts remain remote for the workflow reason above.
- Screen hierarchy changes, drill-in tab removal and broad emoji/native-dialog replacement are
  intentionally deferred to Phase 1B/2.

## Android emulator verification

Verified on the existing `BarrelIQ_Test` AVD at its native 1080 × 1920 / 420 dpi and with a
temporary 1024 × 2216 override at 420 dpi (390 × 844 dp, the specified target viewport):

- 56 dp AppBar and bottom navigation render above the system safe areas.
- Team / Add / Player state is correct in team and player context.
- The center Add ActionSheet renders with a scrim, handle, close control and three existing actions.
- Android Back closes the ActionSheet first and keeps `MainActivity` focused. This uses the native
  activity's existing back dispatcher to delegate to the shared web-history overlay stack; it does
  not add `@capacitor/app`.
- Overview / Development / Compare / Practice fit as four equal-width tabs without horizontal
  scrolling or a clipped Practice tab.
- The center Add control and label fit inside the 56 dp bottom navigation at 390 × 844 dp.
- At Android font scale 1.3, the team selector remained readable with no horizontal clipping; the
  emulator was restored to 1.0 afterward.

Evidence is stored locally under `tmp/phase1a/` (`exact-final.png`, `exact-action.png`,
`final-back.png`, and `large-text.png`). The display override and font scale were restored after
testing. Physical-device behavior and TalkBack traversal remain unverified.
