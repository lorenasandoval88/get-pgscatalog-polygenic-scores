

// load all traits (paginated) and log stats about them to console  
const BASE = "https://www.pgscatalog.org/rest";
const TRAIT_SUMMARY_KEY = "pgs:trait-summary";

// ---- small helpers ----

async function fetchAllTraits({ pageSize = 50, maxPages = Infinity } = {}) {
  let offset = 0;
  let page = 0;
  const all = [];

  while (page < maxPages) {
    const url = `${BASE}/trait/all?format=json&limit=${pageSize}&offset=${offset}`;
    // console.log(`traits****Requesting: ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
    const data = await r.json();

    const results = Array.isArray(data) ? data : (data.results ?? []);
    if (!Array.isArray(results)) throw new Error("Unexpected trait response shape.");

    all.push(...results);
    page += 1;

    if (results.length === 0) break;
    if (!Array.isArray(data) && data.next == null && results.length < pageSize) break;

    offset += results.length;
  }

  return all;
}

// ---- run/test fetchAllTraits ----
// (async () => {
//   const traits = await fetchAllTraits({ pageSize: 50 });
//   console.log("PGS Catalog trait stats:");
//   console.log("Total traits:", traits.length);
//   console.log("First 5 traits:", traits.slice(0, 5));
//  // console.log(JSON.stringify(traits, null, 2));
// })();

// ---- helpers for stats ----

function formatNumber(value, decimals = 0) {
	if (value == null || Number.isNaN(value)) return "NR";
	return Number(value).toLocaleString(undefined, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
}

async function saveTraitSummary(summary) {
	if (!window.localforage) return;
	await window.localforage.setItem(TRAIT_SUMMARY_KEY, {
		savedAt: new Date().toISOString(),
		summary,
	});
}

async function getStoredTraitSummary() {
    console.log("checking local cache for trait summary...");
	if (!window.localforage) return null;
	return window.localforage.getItem(TRAIT_SUMMARY_KEY);
}

function isCacheWithinMonths(savedAt, months = 3) {
	if (!savedAt) return false;
	const savedDate = new Date(savedAt);
	if (Number.isNaN(savedDate.getTime())) return false;

	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - months);

	return savedDate >= cutoff;
}

function getCategoryEntries(summary) {
	if (Array.isArray(summary?.categories)) return summary.categories;
	if (Array.isArray(summary?.topCategories)) return summary.topCategories;
	return [];
}


function renderStats(summary) { //used in loadStats()
	const statsDiv = document.getElementById("traitDiv");
	if (!statsDiv) return;

	const topCategory = getCategoryEntries(summary)[0];
	const topCategoryLabel = topCategory ? `${topCategory[0]} (${formatNumber(topCategory[1])})` : "NR";

	statsDiv.innerHTML = `
		<div class="small text-muted">
			<div><strong>Total traits:</strong> ${formatNumber(summary.totaltraits)}</div>
			<div><strong>Total categories:</strong> ${formatNumber(summary.totalCategories)}</div>
			<div><strong>Top category:</strong> ${topCategoryLabel}</div>
		</div>
	`;
}


function renderPlot(summary) {//used in loadStats()
	if (typeof Plotly === "undefined") return;

	const chartDiv = document.getElementById("traitChart");
	if (!chartDiv) return;

	const categoryEntries = getCategoryEntries(summary);
	const categories = categoryEntries.map((t) => t[0]);
	const counts = categoryEntries.map((t) => t[1]);

	const data = [
		{
			type: "bar",
			x: counts,
			y: categories,
			orientation: "h",
			marker: { color: "#0d6efd" },
		},
	];

	const layout = {
		title: {
			text: "Reported Categories",
			x: 0.5,
			xanchor: "center",
		},
		margin: { l: 260, r: 20, t: 80, b: 80 },
		xaxis: {
			title: { text: "Score files count", standoff: 18 },
			automargin: true,
		},
		yaxis: { automargin: true },
	};

	Plotly.newPlot(chartDiv, data, layout, { responsive: true });
}

function computeSummary(traits) {//used in loadStats()
	const byCategory = new Map();

	for (const trait of traits) {
		const categories = Array.isArray(trait?.trait_categories) && trait.trait_categories.length
			? trait.trait_categories
			: ["NR"];

		for (const category of categories) {
			byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
		}
	}

	const categories = [...byCategory.entries()]
		.sort((a, b) => b[1] - a[1])
		//.slice(0, 10);

	return {
        traits: traits,
		totaltraits: traits.length,
		totalCategories: byCategory.size,
		categories,
	};
}


//Plot trait statistics: check LocalForage first, use cache only when it was saved within the last 3 months, 
// and otherwise fetch fresh data from PGS and re-cache it.

async function loadStats() {
	const sourceStatus = document.getElementById("traitSourceStatus");
	const output = document.getElementById("traitOutput");
	const cached = await getStoredTraitSummary();
    console.log("Cached trait summary:", cached);
	try {
		if (sourceStatus) sourceStatus.textContent = "Source: loading PGS score metadata...";

		if (cached?.summary && isCacheWithinMonths(cached.savedAt, 3)) {
			renderStats(cached.summary);
			renderPlot(cached.summary);
			if (sourceStatus) sourceStatus.textContent = "Source: local cache (LocalForage, < 3 months)";
			if (output) {
				output.textContent = `Loaded ${formatNumber(cached.summary.totaltraits)} cached traits summary (${cached.savedAt}).`;
			}
			return;
		}

		const traits = await fetchAllTraits({ pageSize: 200 });
		const summary = computeSummary(traits);
		await saveTraitSummary(summary);
        console.log('------------------------------')
        console.log("Total traits fetched:", traits.length);
        console.log("Fetched traits data:", traits);
        console.log("Summary:", summary);
		renderStats(summary);
		renderPlot(summary);

		if (output) {
			output.textContent = `Loaded ${formatNumber(summary.totaltraits)} traits from PGS Catalog.`;
		}
		if (sourceStatus) sourceStatus.textContent = "Source: PGS Catalog REST API (live)";

        
	} catch (error) {
		if (cached?.summary) {
			renderStats(cached.summary);
			renderPlot(cached.summary);
			if (sourceStatus) sourceStatus.textContent = "Source: local cache (LocalForage fallback)";
			if (output) {
				output.textContent = `Loaded ${formatNumber(cached.summary.totaltraits)} cached traits summary (${cached.savedAt}).`;
			}
		} else {
			if (sourceStatus) sourceStatus.textContent = "Source: unavailable";
			if (output) output.textContent = `Error loading stats: ${error.message}`;
		}
		console.error(error);
	}
}



window.loadStats = loadStats;

document.addEventListener("DOMContentLoaded", () => {
	loadStats();
});
