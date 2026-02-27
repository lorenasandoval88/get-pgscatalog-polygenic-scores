import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

const plugins = [resolve(), commonjs()];

export default [
	{
		input: "src/js/loadScores.mjs",
		output: {
			file: "dist/loadScores.bundle.mjs",
			format: "es",
			sourcemap: true,
		},
		plugins,
	},
	{
		input: "src/js/loadTraits.js",
		output: {
			file: "dist/loadTraits.bundle.mjs",
			format: "es",
			sourcemap: true,
		},
		plugins,
	},
];