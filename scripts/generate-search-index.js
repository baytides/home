#!/usr/bin/env node

/**
 * Generate Search Index
 *
 * This script reads HTML files and generates a search index JSON file
 * that can be loaded dynamically for client-side search.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Pages to index (excluding 404 and sitemap-page)
const pages = [
  { file: 'index.html', url: '/', keywords: ['home', 'bay tides', 'environment', 'conservation'] },
  {
    file: 'about.html',
    url: '/about.html',
    keywords: ['about', 'mission', 'team', 'history', 'nonprofit'],
  },
  {
    file: 'projects.html',
    url: '/projects.html',
    keywords: ['projects', 'initiatives', 'bay navigator', 'programs'],
  },
  {
    file: 'volunteer.html',
    url: '/volunteer.html',
    keywords: ['volunteer', 'help', 'join', 'community', 'events'],
  },
  {
    file: 'donate.html',
    url: '/donate.html',
    keywords: ['donate', 'support', 'give', 'contribution', 'funding'],
  },
  {
    file: 'contact.html',
    url: '/contact.html',
    keywords: ['contact', 'email', 'reach', 'message', 'get in touch'],
  },
  {
    file: 'events.html',
    url: '/events.html',
    keywords: ['events', 'calendar', 'activities', 'workshops', 'cleanup'],
  },
  {
    file: 'privacy.html',
    url: '/privacy.html',
    keywords: ['privacy', 'policy', 'data', 'information', 'cookies'],
  },
  {
    file: 'terms.html',
    url: '/terms.html',
    keywords: ['terms', 'service', 'conditions', 'legal', 'agreement'],
  },
  {
    file: 'accessibility.html',
    url: '/accessibility.html',
    keywords: ['accessibility', 'a11y', 'wcag', 'screen reader', 'keyboard'],
  },
];

function extractTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  if (match) {
    // Remove "| Bay Tides" suffix if present
    return match[1].replace(/\s*\|\s*Bay Tides$/, '').trim();
  }
  return '';
}

function extractDescription(html) {
  const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  if (!match) {
    const altMatch = html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
    return altMatch ? altMatch[1] : '';
  }
  return match[1];
}

function generateSearchIndex() {
  const searchIndex = [];

  for (const page of pages) {
    const filePath = join(rootDir, page.file);

    if (!existsSync(filePath)) {
      console.warn(`Warning: ${page.file} not found, skipping...`);
      continue;
    }

    const html = readFileSync(filePath, 'utf-8');
    const title = extractTitle(html);
    const description = extractDescription(html);

    searchIndex.push({
      title: title || page.file.replace('.html', ''),
      description,
      url: page.url,
      keywords: page.keywords,
    });

    console.log(`Indexed: ${page.file} -> "${title}"`);
  }

  // Write to public directory for client-side access
  const outputPath = join(rootDir, 'public', 'search-index.json');
  writeFileSync(outputPath, JSON.stringify(searchIndex, null, 2));
  console.log(`\nSearch index written to: ${outputPath}`);
  console.log(`Total pages indexed: ${searchIndex.length}`);
}

generateSearchIndex();
