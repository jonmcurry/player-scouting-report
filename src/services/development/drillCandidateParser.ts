import fs from "node:fs";
import path from "node:path";

export interface CandidateDrillRecord {
  id: string; // e.g. "D01"
  slug: string; // e.g. "d01-open-stance-drill"
  name: string; // e.g. "Open Stance Drill"
  concept: string; // e.g. "stance_setup"
  targetTags: string[];
  bestFor: string;
  sport: "baseball" | "softball" | "both";
  homeFriendly: boolean;
  equipment: string;
  ageNotes: string;
  minAge: number | null;
  instructions: string;
  cue: string;
  looksRightWhen: string;
  commonMistakes: string[];
  sourceCredit: string;
  demoUrl: string;
  demoTimestamp: string;
  requiresScreen: boolean;
  weightedOrOverspeed: boolean;
  curationStatus: "draft";
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseCandidateDrills(content: string): CandidateDrillRecord[] {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  let currentConcept = "";
  const drills: { id: string; name: string; concept: string; rawLines: string[] }[] = [];
  let current: { id: string; name: string; concept: string; rawLines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sectionMatch = line.match(/^##\s+.*?\(`([a-z0-9_]+)`\)/);
    if (sectionMatch) {
      currentConcept = sectionMatch[1]!;
      continue;
    }
    const drillMatch = line.match(/^###\s+(D\d+)\.\s+(.*)$/);
    if (drillMatch) {
      if (current) drills.push(current);
      current = {
        id: drillMatch[1]!,
        name: drillMatch[2]!.trim(),
        concept: currentConcept,
        rawLines: [],
      };
      continue;
    }
    if (current) {
      if (line.startsWith("## ")) {
        drills.push(current);
        current = null;
      } else {
        current.rawLines.push(line);
      }
    }
  }
  if (current) drills.push(current);

  return drills.map((d) => {
    const text = d.rawLines.join("\n");

    const hasSafety = text.includes("⚠️ **Safety flag");
    const hasAgeFlag = text.includes("⚠️ **flag: check before offering to under-13");

    // Best for
    const bestForMatch = text.match(/- \*\*Best for.*?\:\*\*[ \t]*([^\n]*)/);
    const bestFor = bestForMatch ? bestForMatch[1]!.trim() : "";

    // Sport
    const sportMatch = text.match(/- \*\*Sport:\*\*[ \t]*([a-zA-Z]+)/);
    let sport: "baseball" | "softball" | "both" = "both";
    if (sportMatch) {
      const s = sportMatch[1]!.toLowerCase();
      if (s === "softball" || s === "baseball" || s === "both") {
        sport = s;
      } else {
        sport = "both";
      }
    }

    // Home-friendly
    const hfMatch = text.match(/\*\*Home-friendly:\*\*[ \t]*(yes|no)/i);
    // If it has safety flag requiring a screen or partner in path, home_friendly should be false
    let homeFriendly = hfMatch ? hfMatch[1]!.toLowerCase() === "yes" : true;
    if (hasSafety) {
      homeFriendly = false;
    }

    // Equipment
    const eqMatch = text.match(/\*\*Equipment:\*\*[ \t]*([^\n]*)/);
    const equipment = eqMatch ? eqMatch[1]!.trim() : "bat";

    // Age notes
    const ageMatch = text.match(/- \*\*Age:\*\*[ \t]*([^\n]*)/);
    const ageNotes = ageMatch ? ageMatch[1]!.replace(/⚠️.*$/, "").trim() : "";

    // Min age: if weighted/overspeed flag, enforce min_age 13
    let minAge: number | null = null;
    if (hasAgeFlag) {
      minAge = 13;
    }

    // Cue
    const cueMatch = text.match(/- \*\*Cue:\*\*[ \t]*([^\n]*)/);
    const cue = cueMatch ? cueMatch[1]!.replace(/^["']|["']$/g, "").trim() : "";

    // Looks right when
    const lrMatch = text.match(/- \*\*Looks right when:\*\*[ \t]*([^\n]*)/);
    const looksRightWhen = lrMatch ? lrMatch[1]!.trim() : "";

    // Common mistakes
    const cmMatch = text.match(/- \*\*Common mistakes:\*\*[ \t]*([^\n]*)/);
    const cmRaw = cmMatch ? cmMatch[1]!.trim() : "";
    const commonMistakes = cmRaw
      ? cmRaw
          .split(/[;,]/)
          .map((m) => m.trim())
          .filter(Boolean)
      : [];

    // Source line
    const sourceMatch = text.match(/- \*\*Source:\*\*[ \t]*([^\n]*)/);
    let sourceCredit = "";
    let demoUrl = "";
    let demoTimestamp = "";
    if (sourceMatch) {
      const rawSource = sourceMatch[1]!;
      const urlMatch = rawSource.match(/\[(.*?)\]\((https:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+)\)/);
      if (urlMatch) {
        demoUrl = urlMatch[2]!;
        // Presenter / channel is before the link
        const beforeLink = rawSource.substring(0, rawSource.indexOf("[")).trim().replace(/,\s*$/, "");
        sourceCredit = beforeLink || urlMatch[1]!;
      }
      const timeMatch = rawSource.match(/at\s+~?([0-9:]+)/);
      if (timeMatch) {
        demoTimestamp = timeMatch[1]!;
      }
    }

    // Steps
    const stepsLines: string[] = [];
    let inSteps = false;
    for (const line of d.rawLines) {
      if (line.match(/- \*\*Steps:\*\*/)) {
        inSteps = true;
        continue;
      }
      if (inSteps) {
        const stepMatch = line.match(/^\s*\d+\.\s+(.*)$/);
        if (stepMatch) {
          let step = stepMatch[1]!.trim();
          if (step && !/[.!?]$/.test(step)) {
            step += ".";
          }
          stepsLines.push(step);
        } else if (line.match(/^[-\s]*\*\*/)) {
          inSteps = false;
        }
      }
    }
    const instructions = stepsLines.join(" ");

    const slug = `${d.id.toLowerCase()}-${slugify(d.name)}`;

    return {
      id: d.id,
      slug,
      name: d.name,
      concept: d.concept,
      targetTags: [d.concept],
      bestFor,
      sport,
      homeFriendly,
      equipment,
      ageNotes,
      minAge,
      instructions,
      cue,
      looksRightWhen,
      commonMistakes,
      sourceCredit,
      demoUrl,
      demoTimestamp,
      requiresScreen: hasSafety,
      weightedOrOverspeed: hasAgeFlag,
      curationStatus: "draft" as const,
    };
  });
}

export function loadCandidateDrills(
  filePath: string = path.resolve(process.cwd(), "docs/research/drill-library-candidates-v2.md"),
): CandidateDrillRecord[] {
  const content = fs.readFileSync(filePath, "utf8");
  return parseCandidateDrills(content);
}
