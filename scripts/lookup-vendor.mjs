/**
 * Search the EHI Export vendor database by name, product, or slug.
 *
 * Usage:
 *   node lookup-vendor.mjs <search-term>
 *
 * Filters vendors.json by case-insensitive substring match across
 * developer, product_name, family, and slug fields.
 *
 * - 0 hits: prints message + sample vendors
 * - 1-10 hits: prints full metadata + fetches analysis .md for each
 * - >10 hits: prints summary metadata for first 10, asks for narrower term
 *
 * Examples:
 *   node lookup-vendor.mjs medite
 *   node lookup-vendor.mjs athena
 *   node lookup-vendor.mjs epic
 *   node lookup-vendor.mjs crystal
 */

const BASE = 'https://joshuamandel.com/ehi-export-analysis/data';

const searchTerm = process.argv.slice(2).join(' ').trim();
if (!searchTerm) {
  console.error('Usage: node lookup-vendor.mjs <search-term>');
  console.error('Example: node lookup-vendor.mjs athena');
  process.exit(1);
}

const resp = await fetch(`${BASE}/vendors.json`);
const vendors = await resp.json();

const term = searchTerm.toLowerCase();
const matches = vendors.filter(v =>
  v.developer?.toLowerCase().includes(term) ||
  v.product_name?.toLowerCase().includes(term) ||
  v.family?.toLowerCase().includes(term) ||
  v.slug?.toLowerCase().includes(term)
);

function printMeta(v) {
  console.log(`  ${v.developer} | ${v.product_name}`);
  console.log(`    Grade: ${v.grade || '?'}  Coverage: ${v.coverage || '?'}  Formats: ${(v.export_formats || []).join(', ') || '?'}`);
  console.log(`    Entities: ${v.entity_count ?? '?'}  Fields: ${v.field_count ?? '?'}  EHI docs: ${v.ehi_documentation_url || '—'}`);
  if (v.summary) console.log(`    ${v.summary}`);
}

if (matches.length === 0) {
  console.log(`No vendors matched "${searchTerm}" (${vendors.length} vendors in database).`);
  console.log('\nSample vendors:');
  for (const v of vendors.slice(0, 10)) {
    console.log(`  - ${v.developer}: ${v.product_name}`);
  }
  process.exit(0);
}

if (matches.length > 10) {
  console.log(`${matches.length} vendors matched "${searchTerm}" — showing first 10. Try a more specific term.\n`);
  for (const v of matches.slice(0, 10)) {
    printMeta(v);
    console.log('');
  }
  process.exit(0);
}

// 1-10 hits: full metadata + fetch analysis markdown for each
for (const v of matches) {
  console.log('='.repeat(70));
  console.log(`Developer:      ${v.developer}`);
  console.log(`Product:        ${v.product_name}`);
  console.log(`Family:         ${v.family || '—'}`);
  console.log(`Slug:           ${v.slug}`);
  console.log(`Grade:          ${v.grade || '—'}`);
  console.log(`Coverage:       ${v.coverage || '—'}`);
  console.log(`Approach:       ${v.approach || '—'}`);
  console.log(`Export formats: ${(v.export_formats || []).join(', ') || '—'}`);
  console.log(`Entity count:   ${v.entity_count ?? '—'}`);
  console.log(`Field count:    ${v.field_count ?? '—'}`);
  console.log(`Dictionary:     ${v.has_data_dictionary ?? '—'}`);
  console.log(`Sample data:    ${v.has_sample_data ?? '—'}`);
  console.log(`Billing:        ${v.billing_included ?? '—'}`);
  console.log(`Pat comms:      ${v.patient_communications || '—'}`);
  console.log(`Summary:        ${v.summary || '—'}`);
  console.log(`EHI docs URL:   ${v.ehi_documentation_url || '—'}`);
  console.log(`CHPL IDs:       ${(v.chpl_ids || []).join(', ') || '—'}`);

  if (v.has_analysis) {
    const url = `${BASE}/analyses/${v.slug}.md`;
    console.log(`\n--- Analysis: ${url} ---\n`);
    try {
      const mdResp = await fetch(url);
      if (mdResp.ok) {
        console.log(await mdResp.text());
      } else {
        console.log(`(Could not fetch: ${mdResp.status})`);
      }
    } catch (e) {
      console.log(`(Fetch error: ${e.message})`);
    }
  }
  console.log('');
}

console.log(`Found ${matches.length} vendor(s).`);
