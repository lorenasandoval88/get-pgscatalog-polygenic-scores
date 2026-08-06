import pako from "pako";

const PGS_BASE = "https://www.pgscatalog.org/rest";
const getScoreUrl = (id, build = 37) => `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${id}_hmPOS_GRCh${build}.txt.gz`;

function normalizeIds(ids, ...args) {
	let options = {};
	let moreIds = args;
	const maybeOptions = args.at(-1);
	if (maybeOptions && typeof maybeOptions === "object" && !Array.isArray(maybeOptions)) {
		options = maybeOptions;
		moreIds = args.slice(0, -1);
	}
	const rawIds = moreIds.length ? [ids, ...moreIds] : ids;
	const inputIds = Array.isArray(rawIds) ? rawIds : [rawIds];
	const requestedIds = [...new Set(
		inputIds
			.map((id) => String(id ?? "").trim())
			.filter(Boolean)
	)];
	return { requestedIds, options };
}

function computeScoreSummary(scores = []) {
	const byTrait = new Map();
	const variantCounts = [];

	for (const score of scores) {
		const trait = score?.trait_reported ?? "NR";
		byTrait.set(trait, (byTrait.get(trait) ?? 0) + 1);
		const variants = Number(score?.variants_number);
		if (Number.isFinite(variants)) variantCounts.push(variants);
	}

	variantCounts.sort((a, b) => a - b);
	const mean = variantCounts.length
		? variantCounts.reduce((sum, value) => sum + value, 0) / variantCounts.length
		: null;
	const median = variantCounts.length
		? (variantCounts.length % 2
			? variantCounts[(variantCounts.length - 1) / 2]
			: (variantCounts[variantCounts.length / 2 - 1] + variantCounts[variantCounts.length / 2]) / 2)
		: null;

	const topTraits = [...byTrait.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([trait, count]) => ({ trait, count }));

	return {
		totalScores: scores.length,
		uniqueTraits: byTrait.size,
		variants: {
			min: variantCounts.length ? variantCounts[0] : null,
			max: variantCounts.length ? variantCounts[variantCounts.length - 1] : null,
			mean,
			median,
		},
		topTraits,
	};
}

function computeTraitSummary(traits = []) {
	const byCategory = new Map();

	const getAssociatedPgsIds = (trait) => {
		if (!trait || typeof trait !== "object") return [];
		if (Array.isArray(trait.associated_pgs_ids)) return trait.associated_pgs_ids;
		if (Array.isArray(trait.pgs_ids)) return trait.pgs_ids;
		return [];
	};

	for (const trait of traits) {
		const categories = Array.isArray(trait?.trait_categories) && trait.trait_categories.length
			? trait.trait_categories
			: ["NR"];
		const pgsIds = getAssociatedPgsIds(trait);

		for (const category of categories) {
			if (!byCategory.has(category)) {
				byCategory.set(category, {
					category,
					traits_count: 0,
					pgs_ids: new Set(),
					traits: [],
				});
			}
			const categoryEntry = byCategory.get(category);
			categoryEntry.traits_count += 1;
			pgsIds.forEach((id) => categoryEntry.pgs_ids.add(id));
			categoryEntry.traits.push({
				id: trait?.id ?? trait?.efo_id ?? null,
				data: trait,
			});
		}
	}

	const categories = [...byCategory.values()]
		.map((entry) => ({
			category: entry.category,
			traits_count: entry.traits_count,
			pgs_ids: [...entry.pgs_ids],
			pgs_ids_count: entry.pgs_ids.size,
			traits: entry.traits,
		}))
		.sort((a, b) => b.traits_count - a.traits_count);

	return { traits, categories };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, { retries = 5, baseDelayMs = 1500 } = {}) {
	for (let attempt = 1; attempt <= retries; attempt++) {
		const response = await fetch(url, {
			headers: {
				Accept: "application/json",
				"User-Agent": "Mozilla/5.0",
			},
		});

		if (response.ok) {
			return response.json();
		}

		const retryable = [429, 500, 502, 503, 504].includes(response.status);
		if (!retryable || attempt === retries) {
			throw new Error(`HTTP ${response.status} on ${url}`);
		}

		const waitMs = baseDelayMs * attempt;
		console.warn(`Retry ${attempt}/${retries} after HTTP ${response.status}. Waiting ${waitMs} ms.`);
		await sleep(waitMs);
	}
}

async function fetchAllApiScores({ pageSize = 200 } = {}) {
	let offset = 0;
	const all = [];

	while (true) {
		const url = `${PGS_BASE}/score/all?format=json&limit=${pageSize}&offset=${offset}`;
		const data = await fetchJson(url);
		const results = Array.isArray(data) ? data : (data.results ?? []);

		if (!Array.isArray(results)) {
			throw new Error("Unexpected response format from PGS API.");
		}

		all.push(...results);

		if (results.length === 0) break;
		if (!Array.isArray(data) && data.next == null && results.length < pageSize) break;

		offset += results.length;
		await sleep(250);
	}

	return all;
}

export async function fetchAllScores({ pageSize = 200 } = {}) {
	const results = {
		scores: [],
		summary: null,
		errorMessage: null,
	};

	try {
		const scores = await fetchAllApiScores({ pageSize });
		results.scores = scores;
		results.summary = computeScoreSummary(scores);
		return results;
	} catch (error) {
		results.errorMessage = String(error?.message ?? error);
		return results;
	}
}

export async function fetchSomeScores(ids, ...args) {
	const { requestedIds } = normalizeIds(ids, ...args);
	const scores = [];

	for (const id of requestedIds) {
		try {
			const score = await fetchJson(`${PGS_BASE}/score/${id}`);
			if (score) scores.push(score);
		} catch {
			// keep behavior resilient for partial failures
		}
		await sleep(250);
	}

	return {
		scores,
		summary: computeScoreSummary(scores),
	};
}

export async function fetchTraits({ pageSize = 200 } = {}) {
	let offset = 0;
	const all = [];

	while (true) {
		const url = `${PGS_BASE}/trait/all?format=json&limit=${pageSize}&offset=${offset}`;
		const data = await fetchJson(url);
		const results = Array.isArray(data) ? data : (data.results ?? []);

		if (!Array.isArray(results)) {
			throw new Error("Unexpected trait response shape.");
		}

		all.push(...results);
		if (results.length === 0) break;
		if (!Array.isArray(data) && data.next == null && results.length < pageSize) break;

		offset += results.length;
		await sleep(250);
	}

	return {
		summary: computeTraitSummary(all),
	};
}

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

// Canonical ontology key for a trait: the EFO ID when available.
function getTraitId(trait, index) {
	return trait?.id
		?? trait?.efo_id
		?? trait?.trait_id
		?? getTraitName(trait, index);
}

// Returns entries of [efoId, { label, pgs_ids }] so traits are keyed by ontology ID
// while retaining the human-readable label for display.
function getTraitToPgsIdsFromTraitSummary(traitSummary) {
	const summary = traitSummary?.summary ?? traitSummary;
	const traitEntries = new Map();

	const addEntry = (traitId, label, pgsIds) => {
		const key = String(traitId);
		if (!traitEntries.has(key)) {
			traitEntries.set(key, { label, ids: new Set() });
		}
		const entry = traitEntries.get(key);
		for (const pgsId of pgsIds) {
			entry.ids.add(pgsId);
		}
	};

	const traits = Array.isArray(summary?.traits) ? summary.traits : [];
	traits.forEach((trait, index) => {
		addEntry(
			getTraitId(trait, index),
			getTraitName(trait, index),
			getAssociatedPgsIdsFromTrait(trait)
		);
	});

	if (!traitEntries.size) {
		const categories = Array.isArray(summary?.categories) ? summary.categories : [];
		for (const entry of categories) {
			const categoryName = entry?.category ?? "NR";
			addEntry(categoryName, categoryName, entry?.pgs_ids ?? []);
		}
	}

	return [...traitEntries.entries()]
		.map(([traitId, entry]) => [traitId, { label: entry.label, pgs_ids: [...entry.ids] }])
		.filter(([, entry]) => entry.pgs_ids.length > 0);
}

// Traits are EFO-derived: groupings come from the /trait/all ontology entries,
// linked to scores through associated PGS IDs (mirrors the browser SDK).
export async function getScoresPerTrait({ maxTraits = Infinity, onStatus } = {}) {
	const report = (message) => { if (typeof onStatus === "function") onStatus(message); };

	report("getScoresPerTrait: loading traits...");
	const traitPayload = await fetchTraits();

	report("getScoresPerTrait: loading all scores...");
	const { scores } = await fetchAllScores();
	const scoreById = new Map(
		scores
			.filter((score) => score?.id != null)
			.map((score) => [String(score.id), score])
	);

	const traitEntries = getTraitToPgsIdsFromTraitSummary(traitPayload);
	const scoresPerTrait = {};
	let processedTraits = 0;

	for (const [traitId, { label, pgs_ids: pgsIds }] of traitEntries) {
		if (processedTraits >= maxTraits) break;
		const traitScores = pgsIds.map((id) => scoreById.get(String(id))).filter(Boolean);
		scoresPerTrait[traitId] = {
			efo_id: traitId,
			label,
			pgs_ids: pgsIds,
			scores: traitScores,
			summary: computeScoreSummary(traitScores),
		};
		processedTraits += 1;
	}

	console.log(`getScoresPerTrait: ${processedTraits}/${traitEntries.length} traits linked across ${scoreById.size} scores.`);
	report(`getScoresPerTrait: done — ${processedTraits} traits.`);

	return {
		processedTraits,
		totalTraitEntries: traitEntries.length,
		scoresPerTrait,
	};
}

export async function getScoresPerCategory({ maxCategories = Infinity } = {}) {
	const traitPayload = await fetchTraits();
	const { scores } = await fetchAllScores();
	const scoreById = new Map(scores.map((score) => [String(score?.id), score]));

	const categories = Array.isArray(traitPayload?.summary?.categories)
		? traitPayload.summary.categories
		: [];

	const limitedCategories = categories.slice(0, maxCategories);
	const scoresPerCategory = {};

	for (const category of limitedCategories) {
		const pgsIds = Array.isArray(category?.pgs_ids) ? category.pgs_ids : [];
		const categoryScores = pgsIds
			.map((id) => scoreById.get(String(id)))
			.filter(Boolean);

		scoresPerCategory[category.category ?? "NR"] = {
			pgs_ids: pgsIds,
			scores: categoryScores,
			summary: computeScoreSummary(categoryScores),
		};
	}

	return {
		processedCategories: limitedCategories.length,
		totalCategoryEntries: categories.length,
		scoresPerCategory,
	};
}

async function fetchScoreText(id = "PGS000050", build = 37) {
	const url = getScoreUrl(id, build);
	const buffer = await (await fetch(url)).arrayBuffer();
	return pako.inflate(buffer, { to: "string" });
}

async function parseScoreText(id, txt) {
	const obj = { id, txt };
	const rows = obj.txt.split(/[\r\n]/g);
	const metaL = rows.filter((row) => row[0] === "#").length;
	obj.meta = { txt: rows.slice(0, metaL) };
	obj.cols = rows[metaL].split(/\t/g);
	obj.dt = rows.slice(metaL + 1).map((row) => row.split(/\t/g));
	if (obj.dt.at(-1)?.length === 1 && obj.dt.at(-1)[0] === "") {
		obj.dt.pop();
	}

	const indInt = [obj.cols.indexOf("chr_position"), obj.cols.indexOf("hm_pos")];
	const indFloat = [obj.cols.indexOf("effect_weight"), obj.cols.indexOf("allelefrequency_effect")];
	const indBol = [obj.cols.indexOf("hm_match_chr"), obj.cols.indexOf("hm_match_pos")];

	obj.dt = obj.dt.map((row) => {
		indFloat.forEach((ind) => {
			if (ind >= 0) row[ind] = parseFloat(row[ind]);
		});
		indInt.forEach((ind) => {
			if (ind >= 0) row[ind] = parseInt(row[ind]);
		});
		indBol.forEach((ind) => {
			if (ind >= 0) row[ind] = (String(row[ind]).toLowerCase() === "true");
		});
		return row;
	});

	obj.meta.txt
		.filter((row) => row[1] !== "#")
		.forEach((line) => {
			const parsed = line.slice(1).split("=");
			obj.meta[parsed[0]] = parsed[1];
		});

	return obj;
}

export async function getPgsTxt(input, _unused, _cache = false) {
	const id = String(input ?? "").trim();
	return parseScoreText(id, await fetchScoreText(id));
}

