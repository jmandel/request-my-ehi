#!/usr/bin/env bun
/**
 * Search the EHI Export vendor database by name, product, or slug.
 *
 * Usage:
 *   bun lookup-vendor.ts <search-term>
 *
 * Examples:
 *   bun lookup-vendor.ts epic
 *   bun lookup-vendor.ts athena
 *   bun lookup-vendor.ts meditech
 */

const BASE = 'https://joshuamandel.com/ehi-export-analysis/data';

const searchTerm = Bun.argv.slice(2).join(' ').trim();
if (!searchTerm) {
  console.error('Usage: bun lookup-vendor.ts <search-term>');
  console.error('Example: bun lookup-vendor.ts athena');
  process.exit(1);
}

interface Vendor {
  developer?: string;
  product_name?: string;
  family?: string;
  slug?: string;
  grade?: string;
  coverage?: string;
  approach?: string;
  export_formats?: string[];
  entity_count?: number;
  field_count?: number;
  ehi_documentation_url?: string;
  summary?: string;
  has_data_dictionary?: boolean;
  has_sample_data?: boolean;
  includes_billing?: boolean;
  patient_communications?: string;
  chpl_ids?: number[];
}

const resp = await fetch(`${BASE}/vendors.json`);
const vendors: Vendor[] = await resp.json();

const term = searchTerm.toLowerCase();
const matches = vendors.filter(v =>
  v.developer?.toLowerCase().includes(term) ||
  v.product_name?.toLowerCase().includes(term) ||
  v.family?.toLowerCase().includes(term) ||
  v.slug?.toLowerCase().includes(term)
);

function printMeta(v: Vendor) {
  console.log(`  ${v.developer} | ${v.product_name}`);
  console.log(`    Grade: ${v.grade || '?'}  Coverage: ${v.coverage || '?'}  Formats: ${(v.export_formats || []).join(', ') || '?'}`);
  console.log(`    Entities: ${v.entity_count ?? '?'}  Fields: ${v.field_count ?? '?'}  EHI docs: ${v.ehi_documentation_url || '—'}`);
  if (v.summary) console.log(`    ${v.summary}`);
}

if (matches.length === 0) {
  console.log(`No vendors matched "${searchTerm}" (${vendors.length} vendors in database).`);
  console.log('\nSample vendors:');
  vendors.slice(0, 5).forEach(v => console.log(`  - ${v.developer}: ${v.product_name}`));
} else if (matches.length <= 10) {
  for (const v of matches) {
    console.log('='.repeat(70));
    console.log(`Developer:      ${v.developer}`);
    console.log(`Product:        ${v.product_name}`);
    if (v.family) console.log(`Family:         ${v.family}`);
    console.log(`Slug:           ${v.slug}`);
    console.log(`Grade:          ${v.grade || '?'}`);
    console.log(`Coverage:       ${v.coverage || '?'}`);
    console.log(`Approach:       ${v.approach || '?'}`);
    console.log(`Export formats: ${(v.export_formats || []).join(', ') || '?'}`);
    console.log(`Entity count:   ${v.entity_count ?? '?'}`);
    console.log(`Field count:    ${v.field_count ?? '?'}`);
    console.log(`Dictionary:     ${v.has_data_dictionary ?? '?'}`);
    console.log(`Sample data:    ${v.has_sample_data ?? '?'}`);
    console.log(`Billing:        ${v.includes_billing ?? '?'}`);
    console.log(`Pat comms:      ${v.patient_communications || '?'}`);
    if (v.summary) console.log(`Summary:        ${v.summary}`);
    console.log(`EHI docs URL:   ${v.ehi_documentation_url || '—'}`);
    if (v.chpl_ids?.length) console.log(`CHPL IDs:       ${v.chpl_ids.join(', ')}`);

    // Fetch analysis if available
    if (v.slug) {
      const analysisUrl = `${BASE}/analyses/${v.slug}.md`;
      console.log(`\n--- Analysis: ${analysisUrl} ---\n`);
      try {
        const analysisResp = await fetch(analysisUrl);
        if (analysisResp.ok) {
          const md = await analysisResp.text();
          console.log(md);
        } else {
          console.log('(No detailed analysis available)');
        }
      } catch {
        console.log('(Could not fetch analysis)');
      }
    }
  }
  console.log(`\nFound ${matches.length} vendor(s).`);
} else {
  console.log(`Found ${matches.length} matches for "${searchTerm}" — showing first 10:\n`);
  matches.slice(0, 10).forEach(printMeta);
  console.log(`\n... and ${matches.length - 10} more. Try a more specific search term.`);
}
