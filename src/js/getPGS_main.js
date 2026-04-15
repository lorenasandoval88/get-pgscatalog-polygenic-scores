

import { loadTraitStats } from "./getPGS_loadTraits.js";

export async function initStats() {
  try {
    await loadTraitStats();
  } catch (err) {
    console.error("Failed to initialize trait stats:", err);
  }
}

if (typeof window !== "undefined") {
  window.initStats = initStats;
  window.loadTraitStats = loadTraitStats;
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initStats);
}


// import {getScoresPerTrait, loadScores, loadAllScores, loadScoreStats } from "./getPGS_loadScores.js";
// import { fetchTraits, loadTraitStats } from "./getPGS_loadTraits.js";

// export async function initStats() {
// 	await Promise.allSettled([loadTraitStats()]);
// 	// await Promise.allSettled([loadTraitStats(), loadScoreStats()]);
// }

// if (typeof window !== "undefined") {
// 	//window.initStats = initStats;
// 	//window.loadScoreStats = loadScoreStats;
// 	window.loadTraitStats = loadTraitStats;
// }

// if (typeof document !== "undefined") {
// 	document.addEventListener("DOMContentLoaded", () => {
// 		initStats();
// 	});
// }

// void (async () => {
// 	console.log("fetchTraits", await fetchTraits());
//     console.log("loadAllScores", await loadAllScores());
//     console.log("getScoresPerTrait", await getScoresPerTrait());
//     	console.log("loadMultipleScores", await loadOneScores(["PGS000010"]));

// 	console.log("loadMultipleScores", await loadMultipleScores(["PGS000010"]));
// })();