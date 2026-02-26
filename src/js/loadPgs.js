
// downloads all score metadata from PGS Catalog and saves it to a JSON file
/**
 * PGS Catalog: fetch all scores + compute summary stats.
 * Works in:
 *  - Node 18+ (has global fetch)
 *  - Modern browsers (CORS usually OK for pgscatalog.org)
 *
 * Source: PGS Catalog REST API base: https://www.pgscatalog.org/rest/  :contentReference[oaicite:3]{index=3}
 */

const BASE = "https://www.pgscatalog.org/rest";

// ---- small helpers ----

async function fetchAllTraits() {//Infinity
    const url = `${BASE}/trait/all?format=json`;
    console.log(`traits****Requesting: ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
    const data = await r.json();
    return data;
}

// ---- run ----
(async () => {
  const traits = await fetchAllTraits();
  console.log("PGS Catalog trait stats:");
  console.log("Total traits:",traits.count,traits);
 // console.log(JSON.stringify(traits, null, 2));
})();


function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted.length === 0) return null;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function inc(map, key) {
  const k = key ?? "NR";
  map.set(k, (map.get(k) ?? 0) + 1);
}

function parseYear(dateStr) {
  // date_release format is typically YYYY-MM-DD or similar; be defensive
  if (!dateStr || typeof dateStr !== "string") return null;
  const m = dateStr.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

// ---- core: fetch all scores (paginated) ---- total: 5298 as of 2024-06-20
async function fetchAllScores({ pageSize = 50, maxPages = 4 } = {}) {//Infinity
  // REST docs indicate paginated responses; default is 50 per page. :contentReference[oaicite:4]{index=4}
  let offset = 0;
  let page = 0;
  const all = [];

  while (page < maxPages) {
    console.log(`Fetching page ${page + 1} (offset ${offset})...`);
    const url = `${BASE}/score/all?format=json&limit=${pageSize}&offset=${offset}`;
    console.log(`Requesting: ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
    const data = await r.json();
    console.log(`Received ${Array.isArray(data) ? data.length : data.results?.length ?? 0} scores.`);
    // Common patterns: {count,next,previous,results:[...]} or plain array
    const results = Array.isArray(data) ? data : (data.results ?? []);
    if (!Array.isArray(results)) throw new Error("Unexpected response shape.");

    all.push(...results);

    page += 1;

    // Stop conditions:
    if (results.length === 0) break;
    if (!Array.isArray(data) && data.next == null && results.length < pageSize) break;

    offset += results.length;
  }

  return all;
}

// ---- compute summary stats from score metadata ----
function computeScoreSummary(scores) {
  const total = scores.length;

  // variants_number stats
  const variants = scores
    .map(s => Number(s.variants_number))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);

  const min = variants[0] ?? null;
  const max = variants[variants.length - 1] ?? null;
  const mean = variants.length
    ? variants.reduce((a, b) => a + b, 0) / variants.length
    : null;

  const median = quantile(variants, 0.5);
  const p95 = quantile(variants, 0.95);

  // categorical counts (field names follow score records returned by REST)
  const byGenomeBuild = new Map();
  const byLicense = new Map();
  const byWeightType = new Map();
  const byTrait = new Map();      // can be large; you might want top-N only
  const byReleaseYear = new Map();

  let missingFtp = 0;

  for (const s of scores) {
    inc(byGenomeBuild, s.genome_build);
    inc(byLicense, s.license);
    inc(byWeightType, s.weight_type);
    inc(byTrait, s.trait_reported);

    const y = parseYear(s.date_release);
    if (y) inc(byReleaseYear, String(y));

    if (!s.ftp_scoring_file) missingFtp += 1; // REST score endpoints include this URL when available :contentReference[oaicite:5]{index=5}
  }

  // convert Maps -> sorted arrays for readability
  const sortDesc = (a, b) => b[1] - a[1];

  const topTraits = [...byTrait.entries()].sort(sortDesc).slice(0, 25);

  return {
    total_scores: total,
    variants_number: {
      n_with_value: variants.length,
      min,
      max,
      mean,
      median,
      p95,
    },
    missing_ftp_scoring_file: missingFtp,
    counts: {
      genome_build: [...byGenomeBuild.entries()].sort(sortDesc),
      license: [...byLicense.entries()].sort(sortDesc),
      weight_type: [...byWeightType.entries()].sort(sortDesc),
      release_year: [...byReleaseYear.entries()].sort(sortDesc),
      top_25_traits: topTraits,
    },
  };
}

// ---- run ----
// (async () => {
//   const scores = await fetchAllScores({ pageSize: 50 });
//   const summary = computeScoreSummary(scores);

//   console.log("PGS Catalog summary stats:");
//   console.log(JSON.stringify(summary, null, 2));
// })();



// async function getScoreSummary(pgsId) {
//   const url = `https://www.pgscatalog.org/rest/score/${encodeURIComponent(pgsId)}?format=json`;
//   const r = await fetch(url);
//   if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
//   const s = await r.json();

//   return {
//     id: s.id,
//     name: s.name,
//     trait_reported: s.trait_reported,
//     trait_efo: (s.trait_efo || []).map(t => `${t.id} (${t.label})`),
//     variants_number: s.variants_number,
//     publication: s.publication
//       ? {
//           id: s.publication.id,
//           title: s.publication.title,
//           doi: s.publication.doi,
//           pmid: s.publication.PMID,
//           date_publication: s.publication.date_publication
//         }
//       : null,
//     ftp_scoring_file: s.ftp_scoring_file,
//     ftp_harmonized_scoring_files: s.ftp_harmonized_scoring_files, // GRCh37/38 often here
//     date_release: s.date_release,
//     license: s.license
//   };
// }

// Example usage
// getScoreSummary("PGS000001").then(console.log).catch(console.error);