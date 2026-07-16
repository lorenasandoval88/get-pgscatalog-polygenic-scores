import localforage from "localforage";
import pako from "pako";
// console.log("get-pgscatalog-scores: getPGS_loadTxts.js loaded")

// load all traits (paginated) and log stats about them to console  
const getScoreUrl = (id, build = 37) => `https://ftp.ebi.ac.uk/pub/databases/spot/pgs/scores/${id}/ScoringFiles/Harmonized/${id}_hmPOS_GRCh${build}.txt.gz`;
const MAX_PGS_CACHE_BYTES = 300 * 1024 * 1024;
const PGS_KEY_PREFIX = "PGS_Catalog:id-";



function getByteSize(value) {
    const encoded = JSON.stringify(value) ?? "";
    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(encoded).length;
    }
    return encoded.length * 2;
}

// Decodes an ArrayBuffer to text, transparently inflating gzip-compressed data
// (magic bytes 0x1f 0x8b) so both `.txt` and `.txt.gz` inputs work.
function bufferToText(buffer) {
    const bytes = new Uint8Array(buffer);
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGzip) {
        return pako.inflate(bytes, { to: "string" });
    }
    return new TextDecoder("utf-8").decode(bytes);
}

// Derives a stable cache id from a file path/URL (filename without .txt/.gz).
function idFromPath(path) {
    const match = String(path).match(/([^/\\?#]+?)(?:\.txt)?(?:\.gz)?(?:[?#].*)?$/i);
    return match?.[1] || String(path);
}

// Resolves a single input into a parsed PGS score object.
// Accepts: a PGS id string ("PGS000050"), a local/remote file path or URL
// (".txt" or ".txt.gz"), or a File / FileList / File-like object.
async function loadScoreTxt(input, cache = true, build = 37) {
    // ── File object / FileList branch ──────────────────────────────────────
    const isFileInstance = typeof File !== "undefined" && input instanceof File;
    const isFileLikeObject = !!input && typeof input === "object" && typeof input.text === "function";
    const isFileListLike = !!input && typeof input === "object" &&
        typeof input.length === "number" && input.length > 0 &&
        typeof input[0]?.text === "function";

    if (isFileInstance || isFileLikeObject || isFileListLike) {
        const file = isFileListLike ? input[0] : input;
        const id = file.name;
        const cacheKey = `${PGS_KEY_PREFIX}${id}`;

        if (cache) {
            console.log("getTxts():",` Cache hit for PGS-Catalog ${id}`);
            const cached = await localforage.getItem(cacheKey);
            if (cached != null) return cached;
        }

        const txt = bufferToText(await file.arrayBuffer());
        const score = await parseScore(id, txt);
        if (cache) {
            score.cachedAt = Date.now();
            await localforage.setItem(cacheKey, score);
        }
        return score;
    }

    if (typeof input !== "string") {
        throw new TypeError("getTxts expects a PGS id string, a path/URL string, or a File object");
    }

    // ── PGS id vs. file path/URL branch ────────────────────────────────────
    const isPgsId = /^PGS\d+$/i.test(input.trim());
    const id = isPgsId ? input.trim() : idFromPath(input);
    const cacheKey = `${PGS_KEY_PREFIX}${id}`;

    if (cache) {
        const cached = await localforage.getItem(cacheKey);
        if (cached != null) return cached;
    }

    let txt;
    if (isPgsId) {
        txt = await fetchScore(id, build);
    } else {
        const response = await fetch(input);
        if (!response.ok) {
            throw new Error(`Failed to load ${input}: ${response.status}`);
        }
        txt = bufferToText(await response.arrayBuffer());
    }

    const score = await parseScore(id, txt);
    if (cache) {
        score.cachedAt = Date.now();
        await localforage.setItem(cacheKey, score);
    }
    return score;
}

async function getTxts(inputs, _unused, cache = true) {
    // console.log("getTxts()", inputs)
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const data = await Promise.all(list.map((input) => loadScoreTxt(input, cache)));
    if (cache) {
        await limitStorage(data.map((score) => score.id));
    }
    return data
}


// evicts in this order:First: cached PGS_Catalog:id-* entries whose IDs are not in current ids.
// Then (only if still over limit): entries whose IDs are in current ids.
async function limitStorage(ids = []){
    const entries = [];
    let totalBytes = 0;
    const requestedIds = new Set((ids || []).map(id => String(id)));

    await localforage.iterate((value, key) => {
        if (!key.startsWith(PGS_KEY_PREFIX)) {
            return;
        }
        const entryBytes = getByteSize({ key, value });
        const createdAt = Number(value?.cachedAt) || 0;
        const id = key.slice(PGS_KEY_PREFIX.length);

        entries.push({ key, id, entryBytes, createdAt });
        totalBytes += entryBytes;
        //console.log(`Cached pgs entries: ${key}, Size: ${(entryBytes / 1024 / 1024).toFixed(2)} MB`);
    });

    if (totalBytes < MAX_PGS_CACHE_BYTES) {
        // console.log(`Cache limit: ${(MAX_PGS_CACHE_BYTES / 1024 / 1024).toFixed(0)} MB. Current usage: ${(totalBytes / 1024 / 1024).toFixed(2)} MB. No eviction needed.`);
        return;
    }

    const notRequestedEntries = entries
        .filter(entry => !requestedIds.has(entry.id))
        .sort((a, b) => a.createdAt - b.createdAt);

    const requestedEntries = entries
        .filter(entry => requestedIds.has(entry.id))
        .sort((a, b) => a.createdAt - b.createdAt);

    const evictionOrder = [...notRequestedEntries, ...requestedEntries];

    for (const entry of evictionOrder) {
        if (totalBytes < MAX_PGS_CACHE_BYTES) {
            break;
        }
        await localforage.removeItem(entry.key);
        totalBytes -= entry.entryBytes;
    }
    // console.log(`Cache after eviction: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

}

async function fetchScore(id = 'PGS000050', build = 37, range) {
    // console.log("loadScore")
    let txt = ""
    const MAX_ROWS = 1000000

    const url = getScoreUrl(id, build);
    // console.log("loading harmonized pgs score from url", url)

    if (range) {
        if (typeof (range) == 'number') {
            range = [0, range]
        }
        txt = pako.inflate(await (await fetch(url, {
            headers: {
                'content-type': 'multipart/byteranges',
                'range': `bytes=${range.join('-')}`,
            }
        })).arrayBuffer(), {
            to: 'string'
        })
    } else {
        txt = pako.inflate(await (await fetch(url)).arrayBuffer(), {
            to: 'string'
        })
    }

    const rowCount = txt.split(/\r\n|\n|\r/g).length
    if (rowCount > MAX_ROWS) {
        return "failed to fetch. File freater than 1M rows!"
    }

    // Check if PGS catalog FTP site is down-----------------------
    let response
    response = await fetch(url) // testing url 'https://httpbin.org/status/429'
    if (response?.ok) {
        ////console.log('Use the response here!');
    } else {
        txt = `:( Error loading PGS file. HTTP Response Code: ${response?.status}`
        document.getElementById('pgsTextArea').value = txt
    }
    return txt
}

// create PGS obj and data --------------------------
async function parseScore(id, txt) {
    console.log(`parseScore: Parsing PGS scoring file ${id} (${txt.length} chars)`);

    let obj = {id: id}
    obj.txt = txt
    let rows = obj.txt.split(/[\r\n]/g)
    let metaL = rows.filter(r => (r[0] == '#')).length
    obj.meta = {
        txt: rows.slice(0, metaL)
    }
    obj.cols = rows[metaL].split(/\t/g)
    obj.dt = rows.slice(metaL + 1).map(r => r.split(/\t/g))
    if (obj.dt.slice(-1).length == 1) {
        obj.dt.pop(-1)
    }
    // parse numerical types
    const indInt = [obj.cols.indexOf('chr_position'), obj.cols.indexOf('hm_pos')]
    const indFloat = [obj.cols.indexOf('effect_weight'), obj.cols.indexOf('allelefrequency_effect')]
    const indBol = [obj.cols.indexOf('hm_match_chr'), obj.cols.indexOf('hm_match_pos')]

    // /* this is the efficient way to do it, but for large files it has memory issues
    obj.dt = obj.dt.map(r => {
        // for each data row
        indFloat.forEach(ind => {
            r[ind] = parseFloat(r[ind])
        })
        indInt.forEach(ind => {
            r[ind] = parseInt(r[ind])
        })
        indBol.forEach(ind => {
            r[ind] = (r[11] == 'True') ? true : false
        })
        return r
    })
    // parse metadata
    obj.meta.txt.filter(r => (r[1] != '#')).forEach(aa => {
        aa = aa.slice(1).split('=')
        obj.meta[aa[0]] = aa[1]
    })
    return obj
}


export {
    getTxts,
    parseScore
}