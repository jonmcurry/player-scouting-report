import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const EVAL_CONFIG = /\b(?:HITTERLOOP_EVAL(?:_[A-Z0-9]+)*|EVAL(?:UATION)?_(?:ROOT|BUCKET|STORAGE|DATA|RESULTS|PROJECT)(?:_[A-Z0-9]+)*)\b/i;
const EVAL_PATH = /(?:^|[\/\\])(?:eval-data|eval-results|golden)(?:[\/\\]|$)|(?:^|[\/\\])(?:src[\/\\])?eval(?:[\/\\]|$)/i;

function literalValue(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalValue(node.left), right = literalValue(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const part of node.templateSpans) {
      const expression = literalValue(part.expression);
      if (expression === undefined) return undefined;
      value += expression + part.literal.text;
    }
    return value;
  }
  return undefined;
}

/** Reserved configuration identifiers and evaluation imports/paths may not enter
 * production source, including shared helpers and Deno Edge Functions. This is
 * an architectural check, not an interpreter or a replacement for separate IAM. */
export function inspectProductionSource(source, filename = 'source.ts') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const violations = new Set();
  const visit = node => {
    const value = ts.isIdentifier(node) ? node.text : literalValue(node);
    if (value !== undefined && (EVAL_CONFIG.test(value) || EVAL_PATH.test(value.replaceAll('\\', '/')))) {
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      violations.add(line);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...violations].sort((a, b) => a - b);
}

export function checkEvaluationIsolation(root = REPO_ROOT) {
  const violations = [];
  let checked = 0;
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      // Evaluation code and automated tests have no production entry points.
      if (name === 'src/eval' || /(?:^|\/)node_modules(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) continue;
      if (entry.isSymbolicLink()) throw new Error('Evaluation isolation cannot inspect a symlinked production entry.');
      if (entry.isDirectory()) walk(name);
      else if (/\.[cm]?[jt]sx?$/.test(name)) {
        checked++;
        const source = fs.readFileSync(path.join(root, name), 'utf8');
        for (const line of inspectProductionSource(source, name)) violations.push({ file: name, line });
      }
    }
  }
  for (const directory of ['src', 'supabase/functions', 'coach']) walk(directory);
  if (!checked) throw new Error('No production source was checked.');
  return { checked, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = checkEvaluationIsolation();
    if (result.violations.length) {
      // Source locations only: never print the configuration value or code line.
      for (const v of result.violations) console.error(`Evaluation isolation: ${v.file}:${v.line} references reserved evaluation configuration or storage. Move evaluation work into src/eval; production must not import it.`);
      process.exitCode = 1;
    } else console.log(`Evaluation isolation passed (${result.checked} production source files).`);
  } catch {
    console.error('Evaluation isolation could not inspect production source. Check source directories locally.');
    process.exitCode = 1;
  }
}
