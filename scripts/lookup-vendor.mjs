/**
 * Look up an EHR vendor from the ehi-export-analysis database.
 *
 * Usage:
 *   node lookup-vendor.mjs <search-term>
 *
 * Searches vendor names, product names, and slugs for a match.
 * Prints matching vendor details and the URL for the full analysis report.
 *
 * Examples:
 *   node lookup-vendor.mjs "crystal practice"
 *   node lookup-vendor.mjs "athenahealth"
 *   node lookup-vendor.mjs "epic"
 *   node lookup-vendor.mjs "nextgen"
 */

const BASE = 'https://joshuamandel.com/ehi-export-analysis/data';

const searchTerm = process.argv[2];
if (!searchTerm) {
  console.error('Usage: node lookup-vendor.mjs <search-term>');
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

if (matches.length === 0) {
  console.log(`No vendors matched "${searchTerm}".`);
  console.log(`\nThere are ${vendors.length} vendors in the database. Try a broader search term.`);
  console.log('\nSample vendors:');
  for (const v of vendors.slice(0, 10)) {
    console.log(`  - ${v.developer}: ${v.product_name} (${v.slug})`);
  }
  process.exit(0);
}

for (const v of matches) {
  console.log('='.repeat(70));
  console.log(`Developer:        ${v.developer}`);
  console.log(`Product:          ${v.product_name}`);
  console.log(`Family:           ${v.family || '—'}`);
  console.log(`Slug:             ${v.slug}`);
  console.log(`Grade:            ${v.grade || '—'}`);
  console.log(`Coverage:         ${v.coverage || '—'}`);
  console.log(`Approach:         ${v.approach || '—'}`);
  console.log(`Export formats:   ${(v.export_formats || []).join(', ') || '—'}`);
  console.log(`Entity count:     ${v.entity_count ?? '—'}`);
  console.log(`Field count:      ${v.field_count ?? '—'}`);
  console.log(`Data dictionary:  ${v.has_data_dictionary ?? '—'}`);
  console.log(`Summary:          ${v.summary || '—'}`);
  console.log(`EHI docs URL:     ${v.ehi_documentation_url || '—'}`);
  console.log(`CHPL IDs:         ${(v.chpl_ids || []).join(', ') || '—'}`);
  if (v.has_analysis) {
    console.log(`Analysis report:  ${BASE}/analyses/${v.slug}.md`);
  }
  console.log('');
}

console.log(`Found ${matches.length} matching vendor(s).`);
