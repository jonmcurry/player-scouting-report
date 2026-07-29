"""
Publish gate for render_public_skeleton.py's output. This project has no
build/regeneration step for an already-populated player report -
generate_team_reports.ps1's own docstring says it never touches a report again
once real data exists; reports are hand-edited HTML, published by committing
directly (see reports/README or CLAUDE.md for that workflow). So the gate
belongs here, as a manual check a coach/dev runs before hand-embedding a
clip's rendered WebP frames into a real report, not inside the generator.

Refuses (exit 1) unless render_manifest.json (written by
render_public_skeleton.py) has BOTH "validated": true (the pipeline's own
contact.confidence == "high" signal) AND a non-null "approvedBy" (set by hand
after a coach watches that clip's overlay.mp4 - the real-video QA render).
Missing either one means: don't embed this yet.

Usage: python check_publish_gate.py <clip_out_dir>
Exit 0 + "OK to embed" if both conditions hold; exit 1 + the reason otherwise.
"""
import sys
import json
import pathlib


def main():
    if len(sys.argv) != 2:
        print("Usage: python check_publish_gate.py <clip_out_dir>")
        sys.exit(1)

    out_dir = pathlib.Path(sys.argv[1])
    manifest_path = out_dir / "render_manifest.json"
    if not manifest_path.exists():
        print(f"BLOCKED: no render_manifest.json in {out_dir} - run render_public_skeleton.py first.")
        sys.exit(1)

    manifest = json.loads(manifest_path.read_text())
    clip = manifest.get("clip", out_dir.name)

    if not manifest.get("validated"):
        print(f"BLOCKED ({clip}): not validated - {manifest.get('reason')}")
        sys.exit(1)

    if not manifest.get("approvedBy"):
        print(f"BLOCKED ({clip}): validated, but no coach sign-off yet.")
        print(f"  Watch the real-video QA render, then set \"approvedBy\" in {manifest_path} "
              "to that coach's name before embedding this clip's frames in a report.")
        sys.exit(1)

    print(f"OK to embed ({clip}): validated and approved by {manifest['approvedBy']}.")
    sys.exit(0)


if __name__ == "__main__":
    main()
