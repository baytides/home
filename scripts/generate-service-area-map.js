#!/usr/bin/env node

/**
 * Generate Service Area Map
 *
 * Builds the inline SVG path data for the Bay Area service-region map shown on
 * the contact page, from US Census county boundaries (via us-atlas, which is
 * derived from the Census TIGER/Line cartographic boundary files — public domain).
 *
 * The output is committed to src/data/service-area-map.json so the site build
 * and the runtime stay free of any mapping dependency. Re-run this only when the
 * county list changes:
 *
 *   node scripts/generate-service-area-map.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { feature } from 'topojson-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// The ten counties Bay Tides serves, keyed by Census FIPS code.
const COUNTIES = {
  '06001': 'Alameda',
  '06013': 'Contra Costa',
  '06041': 'Marin',
  '06055': 'Napa',
  '06075': 'San Francisco',
  '06081': 'San Mateo',
  '06085': 'Santa Clara',
  '06087': 'Santa Cruz',
  '06095': 'Solano',
  '06097': 'Sonoma',
};

// Rendered SVG canvas. Height is derived from the region's aspect ratio.
const WIDTH = 600;
const PADDING = 8;
const PRECISION = 1;

// How far beyond the service area to extend the canvas, as a fraction of the
// region's size. This is the surrounding context — neighbouring California
// counties and the ocean — that stops the service area reading as a floating
// island. Anything past the viewBox is clipped by the SVG viewport.
const CONTEXT_MARGIN = 0.28;

/** Every [lng, lat] ring in a Polygon or MultiPolygon, as a flat list. */
function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

/**
 * Area of a ring in projected space, via the shoelace formula.
 * Used to find each county's largest landmass for label placement.
 */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum / 2);
}

/** Centroid of a ring in projected space. */
function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }
  area /= 2;
  if (area === 0) return ring[0];
  return [x / (6 * area), y / (6 * area)];
}

function round(n) {
  return Number(n.toFixed(PRECISION));
}

function generate() {
  const topology = JSON.parse(
    readFileSync(join(rootDir, 'node_modules/us-atlas/counties-10m.json'), 'utf-8')
  );
  const counties = feature(topology, topology.objects.counties).features;

  const selected = Object.keys(COUNTIES).map((fips) => {
    const match = counties.find((c) => c.id === fips);
    if (!match) throw new Error(`County ${fips} (${COUNTIES[fips]}) not found in us-atlas`);
    return { fips, name: COUNTIES[fips], geometry: match.geometry };
  });

  // Geographic bounds of the whole service region.
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const { geometry } of selected) {
    for (const ring of ringsOf(geometry)) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  // Extend the frame outward so surrounding land and ocean are visible.
  const marginLng = (maxLng - minLng) * CONTEXT_MARGIN;
  const marginLat = (maxLat - minLat) * CONTEXT_MARGIN;
  const viewMinLng = minLng - marginLng;
  const viewMaxLng = maxLng + marginLng;
  const viewMinLat = minLat - marginLat;
  const viewMaxLat = maxLat + marginLat;

  // Equirectangular projection with longitude compressed by cos(mean latitude).
  // Over a region this small the difference from a true Mercator is sub-pixel,
  // and it keeps the output dependency-free.
  const lngScale = Math.cos(((viewMinLat + viewMaxLat) / 2) * (Math.PI / 180));
  const spanX = (viewMaxLng - viewMinLng) * lngScale;
  const spanY = viewMaxLat - viewMinLat;
  const scale = (WIDTH - PADDING * 2) / spanX;
  const height = spanY * scale + PADDING * 2;

  const project = ([lng, lat]) => [
    (lng - viewMinLng) * lngScale * scale + PADDING,
    // SVG y grows downward, latitude grows upward.
    (viewMaxLat - lat) * scale + PADDING,
  ];

  // Neighbouring counties that fall inside the extended frame. Drawn behind the
  // service area as muted context land; the gaps between them are the bay and
  // the ocean, which the SVG background shows through.
  const serviceIds = new Set(Object.keys(COUNTIES));
  const contextPaths = [];
  for (const county of counties) {
    if (serviceIds.has(county.id)) continue;
    if (!county.geometry) continue;

    let rings;
    try {
      rings = ringsOf(county.geometry);
    } catch {
      continue;
    }

    // Keep only counties that actually overlap the frame, so the output stays
    // small instead of carrying all ~3,200 US counties.
    const overlaps = rings.some((ring) =>
      ring.some(
        ([lng, lat]) =>
          lng >= viewMinLng && lng <= viewMaxLng && lat >= viewMinLat && lat <= viewMaxLat
      )
    );
    if (!overlaps) continue;

    for (const ring of rings) {
      const projected = ring.map(project);
      contextPaths.push(`M${projected.map(([x, y]) => `${round(x)},${round(y)}`).join('L')}Z`);
    }
  }

  const features = selected.map(({ fips, name, geometry }) => {
    const projected = ringsOf(geometry).map((ring) => ring.map(project));

    const path = projected
      .map((ring) => `M${ring.map(([x, y]) => `${round(x)},${round(y)}`).join('L')}Z`)
      .join('');

    // Place the label on the county's largest landmass, not the average of
    // all its islands — otherwise San Francisco's label lands in the ocean.
    const largest = projected.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
    const [labelX, labelY] = ringCentroid(largest);

    return { fips, name, path, labelX: round(labelX), labelY: round(labelY) };
  });

  const output = {
    // Regenerate with: node scripts/generate-service-area-map.js
    source: 'US Census Bureau TIGER/Line cartographic boundaries, via us-atlas (public domain)',
    viewBox: `0 0 ${WIDTH} ${Math.round(height)}`,
    width: WIDTH,
    height: Math.round(height),
    context: contextPaths.join(''),
    counties: features,
  };

  const outputPath = join(rootDir, 'src/data/service-area-map.json');
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  const bytes = Buffer.byteLength(JSON.stringify(output));
  console.log(`Wrote ${outputPath}`);
  console.log(
    `  ${features.length} counties, viewBox "${output.viewBox}", ${(bytes / 1024).toFixed(1)} KB`
  );
}

generate();
