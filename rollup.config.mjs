import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

const plugins = [
    resolve({
        browser: true,
        preferBuiltins: false,
    }),
    commonjs(),
];


export default [{
    input: "src/js/getPGS_loadScores.js",
        output: {
            file: "dist/loadScores.bundle.mjs",
            format: "es",
            sourcemap: true,
        },
        plugins,
    },
    {
        input: "src/js/getPGS_loadTraits.js",
        output: {
            file: "dist/loadTraits.bundle.mjs",
            format: "es",
            sourcemap: true,
        },
        plugins
    },
    {
        input: "sdk.js",
        output: {
            file: "dist/sdk.mjs",
            format: "es",
            sourcemap: true,
        },
        plugins,
    },
];