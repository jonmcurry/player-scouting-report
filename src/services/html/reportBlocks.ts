/**
 * Shared logic for reading and writing the `const NAME = [ ... ];` data blocks
 * embedded in the report HTML templates (GAME_LOG, CHECKLIST, ISSUES). Used
 * by both migrate.ts (HTML -> Supabase) and generate.ts (Supabase -> HTML),
 * so the two directions of this round-trip share one implementation of
 * "where exactly does this block start and end" rather than two independently
 * maintained copies that could quietly drift apart.
 */

/**
 * Finds `const <name> = [ ... ];` in an HTML string and returns its
 * [startIndex, endIndex) span (start = the `const` keyword, end = just after
 * the closing `;`), or null if not found. Scans bracket depth manually
 * (rather than a naive `/\[[\s\S]*?\];/` regex) so a literal "]" inside one of
 * the many free-text notes/evidence strings in these reports can't truncate
 * the match early - real report content includes plenty of these.
 */
export function findConstArraySpan(
  html: string,
  constName: string,
): { start: number; end: number } | null {
  const marker = `const ${constName} = [`;
  const markerStart = html.indexOf(marker);
  if (markerStart === -1) return null;

  const openBracketIdx = markerStart + marker.length - 1;
  let depth = 0;
  let inString: '"' | "'" | "`" | false = false;
  let escaped = false;
  let closeBracketIdx = -1;

  for (let i = openBracketIdx; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inString) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        closeBracketIdx = i;
        break;
      }
    }
  }
  if (closeBracketIdx === -1) {
    throw new Error(`Unbalanced brackets parsing "const ${constName}" - malformed report HTML?`);
  }

  // Include a trailing ";" if present immediately after the closing bracket
  // (every real template does this, but don't fail if some future variant
  // omits it).
  let end = closeBracketIdx + 1;
  if (html[end] === ";") end += 1;

  return { start: markerStart, end };
}

/**
 * Evaluates the array literal text found by findConstArraySpan as JS (NOT
 * JSON - these use unquoted keys, e.g. `{ label: "Load", score: 2 }`).
 *
 * Safety: `new Function` runs arbitrary JS, which would be dangerous on
 * untrusted input - it is NOT dangerous here because this only ever runs
 * against report files this project itself authored and already trusts (the
 * same files a human already hand-edits directly today), never on remote or
 * user-uploaded content.
 */
export function extractConstArray<T>(html: string, constName: string): T[] {
  const span = findConstArraySpan(html, constName);
  if (!span) return [];
  const marker = `const ${constName} = `;
  const literalText = html.slice(span.start + marker.length, span.end).replace(/;\s*$/, "");
  const evaluate = new Function(`"use strict"; return (${literalText});`);
  return evaluate() as T[];
}

/** Safely quotes a string for embedding in a JS source literal - reuses
 * JSON's string-escaping rules, which are a valid subset of JS string syntax
 * (handles quotes, backslashes, control characters, unicode correctly rather
 * than hand-rolled escaping). */
export function jsStringLiteral(value: string | null): string {
  if (value === null) return "null";
  return JSON.stringify(value);
}

/** Replaces an existing `const <name> = [ ... ];` block in html with a freshly
 * serialized one. Throws if the block doesn't already exist - generate.ts
 * only ever updates an existing report's data blocks, never invents new
 * report structure around them (see generate.ts's module docstring for why). */
export function replaceConstArray(html: string, constName: string, newArrayLiteral: string): string {
  const span = findConstArraySpan(html, constName);
  if (!span) {
    throw new Error(`Could not find "const ${constName} = [...]" to replace in this report.`);
  }
  const replacement = `const ${constName} = ${newArrayLiteral};`;
  return html.slice(0, span.start) + replacement + html.slice(span.end);
}

/**
 * Finds the start index of a matching close tag for an already-located open
 * tag, by depth-counting - needed because the "2-5. Diagnosis, Comps & Plan"
 * section's Follow-up block has genuinely NESTED <div>s
 * (`<div class="followup"><div>...</div><div>...</div></div>`), so a naive
 * "next </div>" search would stop at the wrong one.
 *
 * @param openTagEnd index just after the ">" of the opening tag itself
 */
function findMatchingCloseTag(html: string, openTagEnd: number, tagName: string): number {
  const openMarker = `<${tagName}`;
  const closeMarker = `</${tagName}>`;
  let depth = 1;
  let i = openTagEnd;
  while (depth > 0) {
    const nextClose = html.indexOf(closeMarker, i);
    if (nextClose === -1) {
      throw new Error(`No matching "${closeMarker}" found - malformed report HTML?`);
    }
    const nextOpen = html.indexOf(openMarker, i);
    // Only count it as a real nested open tag if followed by a space or ">"
    // (so e.g. "<div" doesn't false-match a hypothetical "<divider" tag).
    const isRealOpen =
      nextOpen !== -1 &&
      nextOpen < nextClose &&
      (html[nextOpen + openMarker.length] === " " || html[nextOpen + openMarker.length] === ">");
    if (isRealOpen) {
      depth++;
      i = html.indexOf(">", nextOpen) + 1;
    } else {
      depth--;
      i = nextClose + closeMarker.length;
    }
  }
  return i - closeMarker.length;
}

/**
 * Finds the `<div class="details-body"...>...</div>` span belonging to the
 * `<details><summary>summaryText</summary>...</details>` block matching
 * summaryText exactly, in the "2-5. Diagnosis, Comps & Plan" section. Used
 * for the 3 sub-sections that are static hand-authored HTML, not JS data
 * (Reference Comp, Drill Recommendations, Follow-up) - unlike
 * findConstArraySpan's blocks, these were never JS literals at all.
 *
 * Returns the span of the details-body DIV's inner content only (between its
 * own opening and closing tag), not the outer <details>/<summary> wrapper -
 * migrate.ts hands this substring to cheerio to parse; generate.ts replaces
 * just this substring, leaving the <details><summary> wrapper untouched.
 */
export function findDetailsBodySpan(
  html: string,
  summaryText: string,
): { start: number; end: number } | null {
  const summaryMarker = `<summary>${summaryText}</summary>`;
  const summaryIdx = html.indexOf(summaryMarker);
  if (summaryIdx === -1) return null;
  const afterSummary = summaryIdx + summaryMarker.length;

  // <details> blocks don't nest in this project's content, so the next
  // "</details>" after the summary is reliably the matching close tag -
  // no depth-counting needed for this outer boundary.
  const detailsEnd = html.indexOf("</details>", afterSummary);
  if (detailsEnd === -1) {
    throw new Error(`No matching "</details>" found for summary "${summaryText}"`);
  }
  const searchWithin = html.slice(afterSummary, detailsEnd);

  const divOpenMatch = searchWithin.match(/<div class="details-body"[^>]*>/);
  if (!divOpenMatch || divOpenMatch.index === undefined) {
    throw new Error(`No <div class="details-body"> found under summary "${summaryText}"`);
  }
  const localOpenTagEnd = divOpenMatch.index + divOpenMatch[0].length;
  const localCloseStart = findMatchingCloseTag(searchWithin, localOpenTagEnd, "div");

  return {
    start: afterSummary + localOpenTagEnd,
    end: afterSummary + localCloseStart,
  };
}

/** Extracts the raw inner HTML of a details-body block (for migrate.ts to
 * hand to cheerio), or null if the summary/block isn't found. */
export function extractDetailsBodyHtml(html: string, summaryText: string): string | null {
  const span = findDetailsBodySpan(html, summaryText);
  if (!span) return null;
  return html.slice(span.start, span.end);
}

/** Replaces the inner content of an existing details-body block. Throws if
 * the block doesn't exist - same "only update what's already there" contract
 * as replaceConstArray. */
export function replaceDetailsBody(html: string, summaryText: string, newBodyHtml: string): string {
  const span = findDetailsBodySpan(html, summaryText);
  if (!span) {
    throw new Error(`Could not find details-body for summary "${summaryText}" to replace.`);
  }
  return html.slice(0, span.start) + newBodyHtml + html.slice(span.end);
}
