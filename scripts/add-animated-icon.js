#!/usr/bin/env node
/**
 * Fetch animated icons from lucide-animated.com registry
 * Usage: node scripts/add-animated-icon.js <icon-name> [icon-name2] ...
 * Example: node scripts/add-animated-icon.js heart arrow-right menu
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '../src/components/icons');
const REGISTRY_URL = 'https://lucide-animated.com/r';

async function fetchIcon(name) {
  const url = `${REGISTRY_URL}/${name}.json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Icon "${name}" not found (${response.status})`);
  }

  return response.json();
}

function transformContent(content) {
  // Replace the @/lib/utils import with our local utils
  return content.replace(/from ["']@\/lib\/utils["']/g, 'from "../../lib/utils"');
}

function toPascalCase(str) {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

async function addIcon(name) {
  console.log(`Fetching ${name}...`);

  const registry = await fetchIcon(name);
  const file = registry.files[0];

  if (!file) {
    throw new Error(`No file found for icon "${name}"`);
  }

  const content = transformContent(file.content);
  const outputPath = join(ICONS_DIR, file.path);

  // Ensure directory exists
  if (!existsSync(ICONS_DIR)) {
    mkdirSync(ICONS_DIR, { recursive: true });
  }

  writeFileSync(outputPath, content);
  console.log(`✓ Created ${outputPath}`);

  return {
    name,
    componentName: `${toPascalCase(name)}Icon`,
    path: file.path,
  };
}

async function updateIndex(icons) {
  const indexPath = join(ICONS_DIR, 'index.ts');
  const exports = icons
    .map((icon) => `export { ${icon.componentName} } from "./${icon.name}";`)
    .join('\n');

  // Read existing index if it exists and merge
  let existingExports = '';
  if (existsSync(indexPath)) {
    const { readFileSync } = await import('fs');
    existingExports = readFileSync(indexPath, 'utf-8');
  }

  // Parse existing exports to avoid duplicates
  const existingLines = new Set(existingExports.split('\n').filter(Boolean));
  const newLines = exports.split('\n').filter(Boolean);

  for (const line of newLines) {
    existingLines.add(line);
  }

  const merged = Array.from(existingLines).sort().join('\n') + '\n';
  writeFileSync(indexPath, merged);
  console.log(`✓ Updated ${indexPath}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/add-animated-icon.js <icon-name> ...');
    console.log('Example: node scripts/add-animated-icon.js heart menu');
    console.log('\nBrowse icons at: https://lucide-animated.com');
    process.exit(1);
  }

  const results = [];

  for (const name of args) {
    try {
      const result = await addIcon(name);
      results.push(result);
    } catch (error) {
      console.error(`✗ Failed to add "${name}": ${error.message}`);
    }
  }

  if (results.length > 0) {
    await updateIndex(results);
    console.log(`\nDone! Added ${results.length} icon(s).`);
    console.log('\nUsage in Astro:');
    console.log('  import { HeartIcon } from "../components/icons";');
    console.log('  <HeartIcon client:visible />');
  }
}

main().catch(console.error);
