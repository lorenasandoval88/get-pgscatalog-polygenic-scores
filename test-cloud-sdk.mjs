// test-cloud-sdk.mjs - Quick validation that cloud_sdk.mjs exports expected SDK functions
import {
  fetchAllScores,
  fetchSomeScores,
  fetchTraits,
  getScoresPerTrait,
  getScoresPerCategory,
  getTxts,
  loadScoreStats,
} from "./dist/cloud_sdk.mjs";

console.log("✓ cloud_sdk.mjs imported successfully (Node-safe)");
console.log("\nExported functions:");
console.log("  - fetchAllScores:", typeof fetchAllScores);
console.log("  - fetchSomeScores:", typeof fetchSomeScores);
console.log("  - fetchTraits:", typeof fetchTraits);
console.log("  - getScoresPerTrait:", typeof getScoresPerTrait);
console.log("  - getScoresPerCategory:", typeof getScoresPerCategory);
console.log("  - getTxts:", typeof getTxts);
console.log("  - loadScoreStats:", typeof loadScoreStats);

console.log("\n✓ cloud_sdk.mjs export surface validated");
