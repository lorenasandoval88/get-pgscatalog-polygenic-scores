// cloudNodeEntry.js - Root entry wrapper for cloud_sdk.mjs
// Re-export selected SDK APIs for cloud/node consumers.

export {
  fetchAllScores,
  fetchSomeScores,
  getScoresPerTrait,
  getScoresPerCategory,
} from "./src/js/getPGS_loadScores.js";

export { loadScoreStats } from "./src/js/landingPage.js";
export { getTxts } from "./src/js/getPGS_loadTxts.js";
export { fetchTraits } from "./src/js/getPGS_loadTraits.js";
