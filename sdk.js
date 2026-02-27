import localforage from "localforage";

export { localforage };
export { loadScores } from "./src/js/loadScores.mjs"; // re-export for external use

// Example usage of loadScores() in an async 
// function, e.g. on page load or button click    