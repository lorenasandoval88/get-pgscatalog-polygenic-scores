import localforage from "localforage";

const PGS_BASE = "https://www.pgscatalog.org/rest";
const ALL_SCORE_SUMMARY_KEY = "pgs:all-score-summary";
const SCORE_SUMMARY_KEY = "pgs:score-summary";

const TRAIT_SUMMARY_KEY = "pgs:trait-summary";

const SCORES_PER_TRAIT_SUMMARY_KEY = "pgs:scores-per-trait-summary";

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

async function saveScoreSummary(results, key = ALL_SCORE_SUMMARY_KEY) {
	if (!localforage) return;
	await localforage.setItem(key, {
		savedAt: new Date().toISOString(),
		summary: results.summary,
		scores: results.scores,
	});
}

async function getStoredScoreSummary(key = ALL_SCORE_SUMMARY_KEY) {
    // console.log("checking local cache for score summary...");
	if (!localforage) return null;
	return localforage.getItem(key);
}

function isCacheWithinMonths(savedAt, months = 3) {
	if (!savedAt) return false;
	const savedDate = new Date(savedAt);
	if (Number.isNaN(savedDate.getTime())) return false;

	const cutoff = new Date();
	cutoff.setMonth(cutoff.getMonth() - months);
	return savedDate >= cutoff;
}



// ---- core: fetch one or more scores by ID ----

export async function fetchScores(ids = []) {
	const inputIds = Array.isArray(ids) ? ids : [ids];
	const normalizedIds = [...new Set(
		inputIds
			.map((id) => String(id ?? "").trim())
			.filter(Boolean)
	)];
	const results = [];

	for (const id of normalizedIds) {
		const url = `${PGS_BASE}/score/${id}`;

		const response = await fetch(url);

		if (!response.ok) {
			console.warn(`Skipping ${id} (status ${response.status})`);
			continue;
		}

		const data = await response.json();
		results.push(data);

		await new Promise((r) => setTimeout(r, 200)); // rate safety
	}

	return results;
}
// ---- core: fetch all scores (paginated) ---- total: 5298 as of 2024-06-20
  // REST docs indicate paginated responses; default is 50 per page. :contentReference[oaicite:4]{index=4}
export async function fetchAllScores({ pageSize = 200 } = {}) {
	let offset = 0;
	const all = [];
	let page = 0;

	// console.log(`[fetchAllScores] start pageSize=${pageSize}`);

	while (true) {
		page += 1;
		const url = `${PGS_BASE}/score/all?format=json&limit=${pageSize}&offset=${offset}`;
		// console.log(`[fetchAllScores] page ${page} request: ${url}`);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status} on ${url}`);
		const data = await response.json();

		const results = Array.isArray(data) ? data : (data.results ?? []);
		if (!Array.isArray(results)) throw new Error("Unexpected response format from PGS API.");

		// console.log(
		// 	`[fetchAllScores] page ${page} received=${results.length} total_so_far=${all.length + results.length}`
		// );

		all.push(...results);

		if (results.length === 0) {
			// console.log(`[fetchAllScores] stop: empty page at page ${page}`);
			break;
		}
		if (!Array.isArray(data) && data.next == null && results.length < pageSize) {
			// console.log(`[fetchAllScores] stop: last page reached at page ${page}`);
			break;
		}

		offset += results.length;
		// console.log(`[fetchAllScores] next offset=${offset}`);
	}
	console.log(`[fetchAllScores] done total=${all.length}`);
	return all;
}

function computeSummary(scores) {//Total scores fetched: 5296,Unique traits: 1,727
	const byTrait = new Map();
	const byTraitPgsIds = new Map();
	const byTraitVariants = new Map();
	const byReleaseYear = new Map();

	const variants = scores
		.map((item) => Number(item.variants_number))
		.filter((v) => Number.isFinite(v))
		.sort((a, b) => a - b);

	for (const score of scores) {
		const trait = score.trait_reported ?? "NR";
		const scoreVariants = Number(score?.variants_number);
		// console.log(`Processing score ID ${score.id}, trait_reported: ${trait}`);
		byTrait.set(trait, (byTrait.get(trait) ?? 0) + 1);
		if (!byTraitPgsIds.has(trait)) {
			byTraitPgsIds.set(trait, new Set());
		}
		if (score?.id) {
			byTraitPgsIds.get(trait).add(score.id);
		}
		if (Number.isFinite(scoreVariants)) {
			if (!byTraitVariants.has(trait)) {
				byTraitVariants.set(trait, {
					min: scoreVariants,
					max: scoreVariants,
				});
			} else {
				const current = byTraitVariants.get(trait);
				current.min = Math.min(current.min, scoreVariants);
				current.max = Math.max(current.max, scoreVariants);
			}
		}

		const yearMatch = (score.date_release ?? "").match(/^(\d{4})/);
		if (yearMatch) {
			const y = yearMatch[1];
			byReleaseYear.set(y, (byReleaseYear.get(y) ?? 0) + 1);
		}
	}

	const topTraits = [...byTrait.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 100);

	const traitToPgsIds = Object.fromEntries(
		[...byTrait.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([trait]) => [trait, [...(byTraitPgsIds.get(trait) ?? new Set())]])
	);

	const releaseYears = [...byReleaseYear.entries()]
		.sort((a, b) => Number(a[0]) - Number(b[0]));

	const traitVariantRange = Object.fromEntries(
		[...byTraitVariants.entries()].map(([trait, range]) => [
			trait,
			{ min: range.min, max: range.max },
		])
	);

	// console.log("topTraits:", [...byTrait.entries()].sort((a, b) => b[1] - a[1]));
	//console.log("traitToPgsIds:", traitToPgsIds);
	
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
		traitToPgsIds,
		traitVariantRange,
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

function renderScorePlot(summary) {
	if (typeof Plotly === "undefined") return;

	const chartDiv = document.getElementById("scoreChart");
	if (!chartDiv) return;

	const topTraits = Array.isArray(summary?.topTraits) ? summary.topTraits : [];
	const traits = topTraits.map((t) => t[0]);
	const counts = topTraits.map((t) => t[1]);
	const customData = topTraits.map((entry) => {
		const min = entry?.[2] ?? "NR";
		const max = entry?.[3] ?? "NR";
		return [min, max];
	});

	const data = [
		{
			type: "bar",
			x: counts,
			y: traits,
			customdata: customData,
			hovertemplate: "Trait: %{y}<br>Score count: %{x}<br>Variants range: %{customdata[0]} - %{customdata[1]}<extra></extra>",
			orientation: "h",
			marker: { color: "#0d6efd" },
		},
	];

	const layout = {
		title: {
			text: "Top 100 Reported Traits",
			x: 0.5,
			xanchor: "center",
		},
		margin: { l: 260, r: 20, t: 90, b: 120 },
		xaxis: {
			title: {
				text: "Scoring files count ",
				standoff: 24,
			},
			side: "bottom",
			automargin: true,
		},
		yaxis: { automargin: true },
	};

	Plotly.newPlot(chartDiv, data, layout, { responsive: true });
}

function getVariantsRangeFromScores(scores = []) {
	const variants = scores
		.map((score) => Number(score?.variants_number))
		.filter((value) => Number.isFinite(value));

	if (!variants.length) {
		return { min: "NR", max: "NR" };
	}

	return {
		min: Math.min(...variants),
		max: Math.max(...variants),
	};
}

function buildTopTraitsFromScoresPerTrait(scoresPerTraitPayload, maxTraits = 100) {
	const entries = Object.entries(scoresPerTraitPayload?.scoresPerTrait ?? {});
	return entries
		.map(([traitName, traitValue]) => {
			const scoreCount = Array.isArray(traitValue?.scores)
				? traitValue.scores.length
				: (Array.isArray(traitValue?.pgs_ids) ? traitValue.pgs_ids.length : 0);
			const variantsRange = getVariantsRangeFromScores(traitValue?.scores ?? []);
			return [traitName, scoreCount, variantsRange.min, variantsRange.max];
		})
		.sort((a, b) => b[1] - a[1])
		.slice(0, maxTraits);
}

// ES6 MODULE: loadAllScores() is the main function to get scores data and summary, 
// using cache if available and valid, and falling back to cache if fetch fails. loadScoreStats() is the main function to render stats and plot, calling loadAllScores() to get data and summary, and updating source status and output messages accordingly.
// Higher-level app function
// Checks LocalForage cache first (3-month validity)
// If needed, calls fetchAllScores(), computes summary, caches result
// Returns { scores, summary } (not just raw array)
export async function loadAllScores() {
	console.log("loadAllScores():Loading scores function...");
	const results = {
		scores: [],
		summary: null,
	};

	const cached = await getStoredScoreSummary(ALL_SCORE_SUMMARY_KEY);
	console.log("loadAllScores():Cached score summary:", cached);

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
		await saveScoreSummary(results, ALL_SCORE_SUMMARY_KEY);
		console.log("------------------------------");
		console.log("Total scores fetched:", scores.length);
		// console.log("Fetched scores data:", scores);
		// console.log("Summary:", summary);

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


// source scores from the cached pgs:all-score-summary dataset first 
// (filtering .scores by requested IDs), and only fall back to network if needed. 
export async function loadScores(ids, ...moreIds) {
	console.log("loadScores():Loading scores function...");
	const results = {
		scores: [],
		summary: null,
	};
	const rawIds = moreIds.length ? [ids, ...moreIds] : ids;
	const inputIds = Array.isArray(rawIds) ? rawIds : [rawIds];
	const requestedIds = [...new Set(
		inputIds
			.map((id) => String(id ?? "").trim())
			.filter(Boolean)
	)];
	const allScoresCached = await getStoredScoreSummary(ALL_SCORE_SUMMARY_KEY);
	console.log("loadScores():all-score cache present:", Boolean(allScoresCached?.scores?.length));

	try {
		if (allScoresCached?.scores && isCacheWithinMonths(allScoresCached.savedAt, 3)) {
			const scoreById = new Map(
				allScoresCached.scores
					.filter((score) => score?.id != null)
					.map((score) => [String(score.id), score])
			);
			const scoresFromAllCache = requestedIds
				.map((id) => scoreById.get(id))
				.filter(Boolean);

			if (scoresFromAllCache.length === requestedIds.length) {
				results.scores = scoresFromAllCache;
				results.summary = computeSummary(scoresFromAllCache);
				return results;
			}

			const missingIds = requestedIds.filter((id) => !scoreById.has(id));
			console.warn("loadScores(): missing IDs in all-score cache, fetching:", missingIds);
			const fetchedMissingScores = await fetchScores(missingIds);
			const fetchedById = new Map(
				fetchedMissingScores
					.filter((score) => score?.id != null)
					.map((score) => [String(score.id), score])
			);

			results.scores = requestedIds
				.map((id) => scoreById.get(id) ?? fetchedById.get(id))
				.filter(Boolean);
			results.summary = computeSummary(results.scores);
			return results;
		}

		const scores = await fetchScores(requestedIds);
		const summary = computeSummary(scores);
		results.scores = scores;
		results.summary = summary;
		console.log("------------------------------");
		console.log("Total scores fetched:", scores.length);
		// console.log("Fetched scores data:", scores);
		// console.log("Summary:", summary);

		return results;
	} catch (error) {
		console.error(error);
		return results;
	}
}

//---------------END OF TRAIT-SCORE LINKING LOGIC------------------

function getAssociatedPgsIdsFromTrait(trait) {
	if (!trait || typeof trait !== "object") return [];

	if (Array.isArray(trait.associated_pgs_ids)) return trait.associated_pgs_ids;
	if (Array.isArray(trait.pgs_ids)) return trait.pgs_ids;
	if (Array.isArray(trait.associated_pgs)) {
		return trait.associated_pgs
			.map((item) => (typeof item === "string" ? item : item?.id ?? item?.pgs_id))
			.filter(Boolean);
	}
	if (Array.isArray(trait.scores)) {
		return trait.scores
			.map((item) => (typeof item === "string" ? item : item?.id ?? item?.pgs_id))
			.filter(Boolean);
	}

	return [];
}

function getTraitName(trait, index) {
	return trait?.label
		?? trait?.trait_label
		?? trait?.name
		?? trait?.trait_reported
		?? trait?.id
		?? `trait-${index + 1}`;
}

function normalizeCategoryEntries(entries) {
	if (!Array.isArray(entries)) return [];

	return entries.map((entry) => {
		if (Array.isArray(entry)) {
			return {
				category: entry[0],
				pgs_ids: Array.isArray(entry[2]) ? entry[2] : [],
			};
		}
		return entry;
	});
}

function getTraitToPgsIdsFromTraitSummary(traitSummary) {
	const summary = traitSummary?.summary ?? traitSummary;
	const traitToPgsIds = new Map();

	const traits = Array.isArray(summary?.traits) ? summary.traits : [];
	if (traits.length) {
		traits.forEach((trait, index) => {
			const traitName = getTraitName(trait, index);
			if (!traitToPgsIds.has(traitName)) {
				traitToPgsIds.set(traitName, new Set());
			}
			const idSet = traitToPgsIds.get(traitName);
			for (const pgsId of getAssociatedPgsIdsFromTrait(trait)) {
				idSet.add(pgsId);
			}
		});
	}

	if (!traitToPgsIds.size) {
		const categories = normalizeCategoryEntries(summary?.categories ?? summary?.topCategories);
		for (const entry of categories) {
			const traitName = entry?.category ?? "NR";
			if (!traitToPgsIds.has(traitName)) {
				traitToPgsIds.set(traitName, new Set());
			}
			const idSet = traitToPgsIds.get(traitName);
			for (const pgsId of (entry?.pgs_ids ?? [])) {
				idSet.add(pgsId);
			}
		}
	}

	return [...traitToPgsIds.entries()]
		.map(([traitName, idSet]) => [traitName, [...idSet]])
		.filter(([, ids]) => ids.length > 0);
}

export async function getScoresPerTrait({ forceRefresh = false, maxTraits = Infinity } = {}) {
	console.log("getScoresPerTrait():Loading scores per trait...");
	const cached = await getStoredScoreSummary(SCORES_PER_TRAIT_SUMMARY_KEY);
	if (!forceRefresh && cached?.scoresPerTrait) {
		return cached;
	}

	const traitSummary = await getStoredScoreSummary(TRAIT_SUMMARY_KEY);
	if (!traitSummary?.summary && !traitSummary?.categories) {
		throw new Error("Missing trait summary cache (TRAIT_SUMMARY_KEY). Run loadTraitStats() first.");
	}

	const traitEntries = getTraitToPgsIdsFromTraitSummary(traitSummary);
	const scoresPerTrait = {};
	let processedTraits = 0;

	for (const [traitName, pgsIds] of traitEntries) {
		if (processedTraits >= maxTraits) break;
		const result = await loadScores(pgsIds);
		scoresPerTrait[traitName] = {
			pgs_ids: pgsIds,
			scores: result.scores,
			summary: result.summary,
		};
		processedTraits += 1;
	}

	const payload = {
		savedAt: new Date().toISOString(),
		sourceTraitSavedAt: traitSummary?.savedAt ?? null,
		processedTraits,
		totalTraitEntries: traitEntries.length,
		scoresPerTrait,
	};

	await localforage.setItem(SCORES_PER_TRAIT_SUMMARY_KEY, payload);
	return payload;
}

//---------------END OF TRAIT-SCORE LINKING LOGIC------------------

// const data = await loadScores();
// const variantSubset30to70 = (data.scores ?? []).filter((score) => {
// 	const variants = Number(score?.variants_number);
// 	return Number.isFinite(variants) && variants >= 30 && variants <= 70;
// });
// console.log("Scores with variants_number between 30 and 70:", variantSubset30to70.length);
// console.log("Subset sample (first 20):", variantSubset30to70.slice(0, 20));


export async function loadScoreStats() {
	const sourceStatus = document.getElementById("scoreSourceStatus");
	const output = document.getElementById("scoreOutput");
	const cached = await getStoredScoreSummary();
	let plotTopTraits = null;
	//console.log("Cached score summary:", cached);

	try {
		if (sourceStatus) sourceStatus.textContent = "Source: loading PGS score metadata...";

		const results = await loadAllScores();
		const summary = results.summary;
		try {
			const scoresPerTrait = await getScoresPerTrait();
			plotTopTraits = buildTopTraitsFromScoresPerTrait(scoresPerTrait, 100);
		} catch (error) {
			console.warn("loadScoreStats(): unable to build topTraits from getScoresPerTrait", error);
		}
		if (!summary) {
			if (sourceStatus) sourceStatus.textContent = "Source: unavailable";
			if (output) output.textContent = "Error loading stats: missing summary data.";
			return { scores: [], summary: null };
		}

		if (cached?.summary && isCacheWithinMonths(cached.savedAt, 3)) {
			const summaryForPlot = {
				...cached.summary,
				topTraits: plotTopTraits ?? cached.summary.topTraits,
			};
			renderStats(cached.summary);
			renderScorePlot(summaryForPlot);
			if (sourceStatus) sourceStatus.textContent = "Source: local cache (all-score-summary + scores-per-trait-summary, < 3 months)";
			if (output) {
				output.textContent = `Loaded ${formatNumber(cached.summary.totalScores)} cached scores summary + trait-linked score cache (${cached.savedAt}).`;
			}
			return results;
		}
		const summaryForPlot = {
			...summary,
			topTraits: plotTopTraits ?? summary.topTraits,
		};
		renderStats(summary);
		renderScorePlot(summaryForPlot);

		if (output) {
			output.textContent = `Loaded ${formatNumber(summary.totalScores)} scores from PGS Catalog and built trait-linked score cache.`;
		}
		if (sourceStatus) sourceStatus.textContent = "Source: PGS Catalog REST API (live; refreshed all-score-summary + scores-per-trait-summary)";
		return results;
	} catch (error) {
		const results = {
			scores: cached?.scores ?? [],
			summary: cached?.summary ?? null,
		};
		if (cached?.summary) {
			renderStats(cached.summary);
			renderScorePlot(cached.summary);
			if (sourceStatus) sourceStatus.textContent = "Source: local cache fallback (all-score-summary + scores-per-trait-summary)";
			if (output) {
				output.textContent = `Loaded ${formatNumber(cached.summary.totalScores)} cached scores summary + trait-linked score cache (${cached.savedAt}).`;
			}
		} else {
			if (sourceStatus) sourceStatus.textContent = "Source: unavailable";
			if (output) output.textContent = `Error loading stats: ${error.message}`;
		}
		console.error(error);
		return results;
	}
}


