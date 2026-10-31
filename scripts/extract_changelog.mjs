#!/usr/bin/env node
/**
 * Extracts the latest release section from CHANGELOG.md (first `## ...` block)
 * and outputs:
 *   1. Full Markdown notes (`--md-out <file>`) for GitHub Releases & Web manifest
 *   2. Google Play `whatsnew/` directory (`--whatsnew-dir <dir>`) with plain-text
 *      notes capped at 490 chars (Google Play enforces max 500 chars per locale).
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    out[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv);
const changelogPath = path.resolve(args.changelog || 'CHANGELOG.md');
const fallbackText = args.fallback || 'Mejoras de estabilidad, rendimiento y nuevas funciones.';

let sectionMd = '';

if (fs.existsSync(changelogPath)) {
  const lines = fs.readFileSync(changelogPath, 'utf8').split(/\r?\n/);
  let inSection = false;
  const collected = [];

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (!inSection) {
        inSection = true;
        collected.push(line);
        continue;
      } else {
        break;
      }
    }
    if (inSection) {
      collected.push(line);
    }
  }
  sectionMd = collected.join('\n').trim();
}

if (!sectionMd) {
  sectionMd = fallbackText;
}

if (args['md-out']) {
  fs.writeFileSync(path.resolve(args['md-out']), `${sectionMd}\n`, 'utf8');
}

// Strip Markdown links/formatting and cap to 490 UTF-16 code units for Play Store
const plainText = sectionMd
  .replace(/^##\s+.*$/m, '')
  .replace(/^###\s+(.*)$/gm, '• $1:')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/[*`]/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const playNotes = (plainText || fallbackText).slice(0, 490).trim();

if (args['plain-out']) {
  fs.writeFileSync(path.resolve(args['plain-out']), `${playNotes}\n`, 'utf8');
}

if (args['whatsnew-dir']) {
  const dir = path.resolve(args['whatsnew-dir']);
  fs.mkdirSync(dir, { recursive: true });
  for (const locale of ['es-419', 'es-ES', 'en-US']) {
    fs.writeFileSync(path.join(dir, `whatsnew-${locale}`), `${playNotes}\n`, 'utf8');
  }
}
