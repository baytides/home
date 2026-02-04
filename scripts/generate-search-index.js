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

// Pages to index (excluding 404, checkout, and legal sub-pages)
const pages = [
  { file: 'index.html', url: '/', keywords: ['home', 'bay tides', 'environment', 'conservation'] },
  {
    file: 'about.html',
    url: '/about',
    keywords: ['about', 'mission', 'team', 'history', 'nonprofit'],
  },
  {
    file: 'projects.html',
    url: '/projects',
    keywords: ['projects', 'initiatives', 'bay navigator', 'programs'],
  },
  {
    file: 'events.html',
    url: '/events',
    keywords: ['events', 'calendar', 'activities', 'workshops', 'cleanup'],
  },
  {
    file: 'volunteer/index.html',
    url: '/volunteer',
    keywords: ['volunteer', 'help', 'join', 'community', 'events'],
  },
  {
    file: 'volunteer/registration.html',
    url: '/volunteer/registration',
    keywords: ['volunteer', 'sign up', 'register', 'application'],
  },
  {
    file: 'donate/index.html',
    url: '/donate',
    keywords: ['donate', 'support', 'give', 'contribution', 'funding'],
  },
  {
    file: 'donate/corporate-partnerships.html',
    url: '/donate/corporate-partnerships',
    keywords: ['corporate', 'partnership', 'sponsor', 'business', 'company'],
  },
  {
    file: 'donate/daf.html',
    url: '/donate/daf',
    keywords: ['daf', 'donor advised fund', 'charitable', 'giving'],
  },
  {
    file: 'donate/in-kind.html',
    url: '/donate/in-kind',
    keywords: ['in-kind', 'goods', 'services', 'equipment', 'supplies'],
  },
  {
    file: 'donate/ira.html',
    url: '/donate/ira',
    keywords: ['ira', 'retirement', 'rollover', 'qcd', 'charitable distribution'],
  },
  {
    file: 'donate/matching.html',
    url: '/donate/matching',
    keywords: ['matching', 'employer', 'double', 'gift match'],
  },
  {
    file: 'donate/planned-giving.html',
    url: '/donate/planned-giving',
    keywords: ['planned giving', 'legacy', 'estate', 'bequest', 'will'],
  },
  {
    file: 'donate/stocks.html',
    url: '/donate/stocks',
    keywords: ['stocks', 'securities', 'shares', 'appreciated assets'],
  },
  {
    file: 'contact.html',
    url: '/contact',
    keywords: ['contact', 'email', 'reach', 'message', 'get in touch'],
  },
  {
    file: 'aegis/index.html',
    url: '/aegis',
    keywords: ['aegis', 'digital', 'nonprofit', 'technology', 'resilience'],
  },
  {
    file: 'aegis/interest.html',
    url: '/aegis/interest',
    keywords: ['aegis', 'interest', 'form', 'apply', 'services'],
  },
  {
    file: 'privacy.html',
    url: '/privacy',
    keywords: ['privacy', 'policy', 'data', 'information', 'cookies'],
  },
  {
    file: 'terms.html',
    url: '/terms',
    keywords: ['terms', 'service', 'conditions', 'legal', 'agreement'],
  },
  {
    file: 'accessibility.html',
    url: '/accessibility',
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
