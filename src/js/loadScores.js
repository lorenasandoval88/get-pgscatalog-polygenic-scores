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

async function saveScoreSummary(summary) {
	if (!window.localforage) return;
	await window.localforage.setItem(SCORE_SUMMARY_KEY, {
		savedAt: new Date().toISOString(),
		summary,
	});
}

async function getStoredScoreSummary() {
    console.log("checking local cache for score summary...");

	if (!window.localforage) return null;
	return window.localforage.getItem(SCORE_SUMMARY_KEY);
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

	while (true) {
		const url = `${PGS_BASE}/score/all?format=json&limit=${pageSize}&offset=${offset}`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status} on ${url}`);
		const data = await response.json();

		const results = Array.isArray(data) ? data : (data.results ?? []);
		if (!Array.isArray(results)) throw new Error("Unexpected response format from PGS API.");

		all.push(...results);

		if (results.length === 0) break;
		if (!Array.isArray(data) && data.next == null && results.length < pageSize) break;

		offset += results.length;
	}
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

async function loadStats() {
	const sourceStatus = document.getElementById("scoreSourceStatus");
	const output = document.getElementById("scoreOutput");
	const cached = await getStoredScoreSummary();
    console.log("Cached score summary:", cached);

	try {
		if (sourceStatus) sourceStatus.textContent = "Source: loading PGS score metadata...";

		if (cached?.summary && isCacheWithinMonths(cached.savedAt, 3)) {
			renderStats(cached.summary);
			renderPlot(cached.summary);
			if (sourceStatus) sourceStatus.textContent = "Source: local cache (LocalForage, < 3 months)";
			if (output) {
				output.textContent = `Loaded ${formatNumber(cached.summary.totalScores)} cached scores summary (${cached.savedAt}).`;
			}
			return;
		}

		const scores = await fetchAllScores({ pageSize: 200 });
		const summary = computeSummary(scores);
		await saveScoreSummary(summary);
        console.log('------------------------------')
        console.log("Total scores fetched:", scores.length);
        console.log("Fetched scores data:", scores);
        console.log("Summary:", summary);
		renderStats(summary);
		renderPlot(summary);

		if (output) {
			output.textContent = `Loaded ${formatNumber(summary.totalScores)} scores from PGS Catalog.`;
		}
		if (sourceStatus) sourceStatus.textContent = "Source: PGS Catalog REST API (live)";
	} catch (error) {
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
	}
}

window.loadStats = loadStats;

document.addEventListener("DOMContentLoaded", () => {
	loadStats();
});
