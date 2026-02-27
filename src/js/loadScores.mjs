import localforage from "localforage";

const PGS_BASE = "https://www.pgscatalog.org/rest";
const SCORE_SUMMARY_KEY = "pgs:score-summary";

function formatNumber(value, decimals = 0) {
	if (value == null || Number.isNaN(value)) return "NR";
	return Number(value).toLocaleString(undefined, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
}

function quantile(sorted, q) {
	if (!sorted.length) return null;
	const pos = (sorted.length - 1) * q;
	const base = Math.floor(pos);
	const rest = pos - base;
	if (sorted[base + 1] === undefined) return sorted[base];
	return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

async function saveScoreSummary(results) {
	if (!localforage) return;
	await localforage.setItem(SCORE_SUMMARY_KEY, {
		savedAt: new Date().toISOString(),
		summary: results.summary,
		scores: results.scores,
	});
}

async function getStoredScoreSummary() {
    // console.log("checking local cache for score summary...");
	if (!localforage) return null;
	return localforage.getItem(SCORE_SUMMARY_KEY);
}

function isCacheWithinMonths(savedAt, months = 3) {
	if (!savedAt) return false;
	const savedDate = new Date(savedAt);
	if (Number.isNaN(savedDate.getTime())) return false;

	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - months);
	return savedDate >= cutoff;
}


// ---- core: fetch all scores (paginated) ---- total: 5298 as of 2024-06-20
  // REST docs indicate paginated responses; default is 50 per page. :contentReference[oaicite:4]{index=4}
async function fetchAllScores({ pageSize = 200 } = {}) {
	let offset = 0;
	const all = [];
	let page = 0;

	console.log(`[fetchAllScores] start pageSize=${pageSize}`);

	while (true) {
		page += 1;
		const url = `${PGS_BASE}/score/all?format=json&limit=${pageSize}&offset=${offset}`;
		console.log(`[fetchAllScores] page ${page} request: ${url}`);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status} on ${url}`);
		const data = await response.json();

		const results = Array.isArray(data) ? data : (data.results ?? []);
		if (!Array.isArray(results)) throw new Error("Unexpected response format from PGS API.");

		console.log(
			`[fetchAllScores] page ${page} received=${results.length} total_so_far=${all.length + results.length}`
		);

		all.push(...results);

		if (results.length === 0) {
			console.log(`[fetchAllScores] stop: empty page at page ${page}`);
			break;
		}
		if (!Array.isArray(data) && data.next == null && results.length < pageSize) {
			console.log(`[fetchAllScores] stop: last page reached at page ${page}`);
			break;
		}

		offset += results.length;
		console.log(`[fetchAllScores] next offset=${offset}`);
	}
	console.log(`[fetchAllScores] done total=${all.length}`);
	return all;
}

function computeSummary(scores) {//Total scores fetched: 5296,Unique traits: 1,727
	const byTrait = new Map();
	const byReleaseYear = new Map();

	const variants = scores
		.map((item) => Number(item.variants_number))
		.filter((v) => Number.isFinite(v))
		.sort((a, b) => a - b);

	for (const score of scores) {
		const trait = score.trait_reported ?? "NR";
		byTrait.set(trait, (byTrait.get(trait) ?? 0) + 1);

		const yearMatch = (score.date_release ?? "").match(/^(\d{4})/);
		if (yearMatch) {
			const y = yearMatch[1];
			byReleaseYear.set(y, (byReleaseYear.get(y) ?? 0) + 1);
		}
	}

	const topTraits = [...byTrait.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10);

	const releaseYears = [...byReleaseYear.entries()]
		.sort((a, b) => Number(a[0]) - Number(b[0]));

	return {
		totalScores: scores.length,
		uniqueTraits: byTrait.size,
		variants: {
			min: variants[0] ?? null,
			max: variants[variants.length - 1] ?? null,
			mean: variants.length ? variants.reduce((sum, n) => sum + n, 0) / variants.length : null,
			median: quantile(variants, 0.5),
		},
		topTraits,
		releaseYears,
	};
}

function renderStats(summary) {
	const statsDiv = document.getElementById("scoreDiv");
	if (!statsDiv) return;

	statsDiv.innerHTML = `
		<div class="small text-muted">
			<div><strong>Total scores:</strong> ${formatNumber(summary.totalScores)}</div>
			<div><strong>Unique traits:</strong> ${formatNumber(summary.uniqueTraits)}</div>
			<div><strong>Variants (median):</strong> ${formatNumber(summary.variants.median)}</div>
			<div><strong>Variants (mean):</strong> ${formatNumber(summary.variants.mean, 2)}</div>
			<div><strong>Variants range:</strong> ${formatNumber(summary.variants.min)} - ${formatNumber(summary.variants.max)}</div>
		</div>
	`;
}

function renderPlot(summary) {
	if (typeof Plotly === "undefined") return;

	const chartDiv = document.getElementById("scoreChart");
	if (!chartDiv) return;

	const traits = summary.topTraits.map((t) => t[0]);
	const counts = summary.topTraits.map((t) => t[1]);

	const data = [
		{
			type: "bar",
			x: counts,
			y: traits,
			orientation: "h",
			marker: { color: "#0d6efd" },
		},
	];

	const layout = {
		title: "Top 10 Reported Traits",
		margin: { l: 260, r: 20, t: 40, b: 40 },
		xaxis: { title: "Score count" },
		yaxis: { automargin: true },
	};

	Plotly.newPlot(chartDiv, data, layout, { responsive: true });
}

// ES6 MODULE: loadScores() is the main function to get scores data and summary, using cache if available and valid, and falling back to cache if fetch fails. loadStats() is the main function to render stats and plot, calling loadScores() to get data and summary, and updating source status and output messages accordingly.
// get scores data from cache if available and not too old, and return results;
// if no cache or cache is too old, fetch from PGS REST API, compute summary, cache it.
// if fetch fails but cache exists, use cache as fallback with notice. if no cache and fetch fails, show error.
export async function loadScores() {
	console.log("loadScores():Loading scores function...");
	const results = {
		scores: [],
		summary: null,
	};

	const cached = await getStoredScoreSummary();
	console.log("loadScores():Cached score summary:", cached);

	try {
		if (cached?.summary && isCacheWithinMonths(cached.savedAt, 3)) {
			results.summary = cached.summary;
			results.scores = cached.scores ?? [];
	
			return results;
		}

		const scores = await fetchAllScores({ pageSize: 200 });
		const summary = computeSummary(scores);
		results.scores = scores;
		results.summary = summary;
		await saveScoreSummary(results);
		console.log("------------------------------");
		console.log("Total scores fetched:", scores.length);
		console.log("Fetched scores data:", scores);
		console.log("Summary:", summary);

		return results;
	} catch (error) {
		if (cached?.summary) {
			results.summary = cached.summary;
			results.scores = cached.scores ?? [];

		} 
		console.error(error);
		return results;
	}
}

// const data = await loadScores();
// const variantSubset30to70 = (data.scores ?? []).filter((score) => {
// 	const variants = Number(score?.variants_number);
// 	return Number.isFinite(variants) && variants >= 30 && variants <= 70;
// });
// console.log("Scores with variants_number between 30 and 70:", variantSubset30to70.length);
// console.log("Subset sample (first 20):", variantSubset30to70.slice(0, 20));


async function loadStats() {
	const sourceStatus = document.getElementById("scoreSourceStatus");
	const output = document.getElementById("scoreOutput");
	const cached = await getStoredScoreSummary();
	//console.log("Cached score summary:", cached);

	try {
		if (sourceStatus) sourceStatus.textContent = "Source: loading PGS score metadata...";

		const results = await loadScores();
		const summary = results.summary;
		if (!summary) {
			if (sourceStatus) sourceStatus.textContent = "Source: unavailable";
			if (output) output.textContent = "Error loading stats: missing summary data.";
			return { scores: [], summary: null };
		}

		if (cached?.summary && isCacheWithinMonths(cached.savedAt, 3)) {
			renderStats(cached.summary);
			renderPlot(cached.summary);
			if (sourceStatus) sourceStatus.textContent = "Source: local cache (LocalForage, < 3 months)";
			if (output) {
				output.textContent = `Loaded ${formatNumber(cached.summary.totalScores)} cached scores summary (${cached.savedAt}).`;
			}
			return results;
		}
		renderStats(summary);
		renderPlot(summary);

		if (output) {
			output.textContent = `Loaded ${formatNumber(summary.totalScores)} scores from PGS Catalog.`;
		}
		if (sourceStatus) sourceStatus.textContent = "Source: PGS Catalog REST API (live)";
		return results;
	} catch (error) {
		const results = {
			scores: cached?.scores ?? [],
			summary: cached?.summary ?? null,
		};
		if (cached?.summary) {
			renderStats(cached.summary);
			renderPlot(cached.summary);
			if (sourceStatus) sourceStatus.textContent = "Source: local cache (LocalForage fallback)";
			if (output) {
				output.textContent = `Loaded ${formatNumber(cached.summary.totalScores)} cached scores summary (${cached.savedAt}).`;
			}
		} else {
			if (sourceStatus) sourceStatus.textContent = "Source: unavailable";
			if (output) output.textContent = `Error loading stats: ${error.message}`;
		}
		console.error(error);
		return results;
	}
}

window.loadStats = loadStats;

document.addEventListener("DOMContentLoaded", () => {
	loadStats();
});
