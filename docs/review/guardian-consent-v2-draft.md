# Guardian consent draft for the simplified app

Status: draft for review before any invitation or consent version change. The current app still
uses `guardian-consent-2026-10-01`; changing the text requires a re-consent gate for existing
guardians and a new `app_settings.guardian_consent_version` value.

## Proposed invite text

> I am this child's parent or legal guardian. I agree that videos I or this child's coaches
> upload to HitterLoop may be stored privately and analyzed by automated tools, including AI
> services from third-party providers. HitterLoop may show an automatic at-bat report to this
> child's coaches and linked parents without a coach reviewing it first. A report may be wrong;
> a linked parent or coach can hide a finding that does not look right.
>
> This child's linked parents and coaches can watch their videos and delete any at-bat for this
> child. I can remove my own access. A linked parent or coach can create a revocable report link;
> someone with that link can read the shared report and see the child's first name and last
> initial. HitterLoop will not place this child's video in a public demo without separate
> permission from a guardian.

## Separate import notice for coaches

> A GameChanger roster screenshot can show several children's names. If you choose screenshot
> import, HitterLoop sends the image to Gemini to read the names and numbers. HitterLoop does
> not save the screenshot after processing. Review the extracted rows before importing. Use a
> CSV or paste a list if you do not want to send the screenshot to Gemini.

## Release checks

- Check the actual provider terms and data handling before claiming a retention period or
  deletion behavior for content sent to Gemini. This draft makes no such claim.
- Require re-consent on the next guardian visit before report/video access after a version
  change; invitations must present the same version as the database accepts.
- Keep public demo publication permission separate from private report link consent. Audit
  both coach and guardian uploads before exporting a child's video to a public fixture.
