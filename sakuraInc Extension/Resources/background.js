const REQUEST_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const NATIVE_APP_ID = "com.fkmstk.sakuraInc.Extension";
const MAX_CACHE_SIZE = 200;
const HTML_ENTITY_PATTERN = /&(amp|lt|gt|quot|#39);/g;
const TITLE_TAG_PATTERN = /<title>(.*?)<\/title>/i;
const SPEC_RESOURCE_PATH = "sakura_parser_spec.json";

const DEFAULT_PARSER_SPEC = {
    titleSuffixPattern: "\\s*-\\s*サクラチェッカー.*$",
    embeddedTextPattern: "サクラ度は\\s*([0-9]{1,3})\\s*です",
    fallbackScorePattern: "<p[^>]*class=[\"'][^\"']*sakura-alert[^\"']*[\"'][^>]*>.*?サクラ度[^0-9]{0,20}([0-9]{1,3})",
    notFoundPatterns: ["見つかりません", "データがありません", "判定できません", "該当する商品はありません"],
    riskBands: [
        { min: 80, level: "very-high", label: "危険" },
        { min: 60, level: "high", label: "注意" },
        { min: 40, level: "medium", label: "やや注意" },
        { min: 20, level: "low", label: "低め" },
        { min: 0, level: "very-low", label: "低リスク" }
    ],
    scoreImageHashes: {}
};

const resultCache = new Map();
let parserSpecPromise = null;

function getRuntimeUrl(path) {
    if (typeof browser !== "undefined" && typeof browser?.runtime?.getURL === "function") {
        return browser.runtime.getURL(path);
    }

    return path;
}

function normalizeAsin(rawValue) {
    const value = String(rawValue ?? "").trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(value) ? value : null;
}

function buildSourceUrl(asin) {
    return `https://sakura-checker.jp/search/${encodeURIComponent(asin)}/`;
}

function decodeHtmlEntities(text) {
    const entities = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": "\"",
        "&#39;": "'"
    };

    return String(text ?? "").replace(HTML_ENTITY_PATTERN, (match) => entities[match] ?? match);
}

function normalizeRiskBands(rawBands) {
    if (!Array.isArray(rawBands)) {
        return [...DEFAULT_PARSER_SPEC.riskBands];
    }

    const normalized = rawBands
        .map((band) => ({
            min: Number.isFinite(Number(band?.min)) ? Number(band.min) : 0,
            level: typeof band?.level === "string" ? band.level : "medium",
            label: typeof band?.label === "string" ? band.label : "判定"
        }))
        .sort((left, right) => right.min - left.min);

    return normalized.length > 0 ? normalized : [...DEFAULT_PARSER_SPEC.riskBands];
}

function normalizeParserSpec(rawSpec) {
    const spec = rawSpec && typeof rawSpec === "object" ? rawSpec : {};

    const notFoundPatterns = Array.isArray(spec.notFoundPatterns)
        ? spec.notFoundPatterns.filter((item) => typeof item === "string" && item.trim().length > 0)
        : DEFAULT_PARSER_SPEC.notFoundPatterns;

    const scoreImageHashes = Object.fromEntries(
        Object.entries(spec.scoreImageHashes ?? {}).filter(([hash, score]) => {
            const validHash = typeof hash === "string" && hash.length > 0;
            const validScore = Number.isFinite(Number(score));
            return validHash && validScore;
        }).map(([hash, score]) => [hash, Number(score)])
    );

    const titleSuffixPattern = typeof spec.titleSuffixPattern === "string"
        ? spec.titleSuffixPattern
        : DEFAULT_PARSER_SPEC.titleSuffixPattern;
    const embeddedTextPattern = typeof spec.embeddedTextPattern === "string"
        ? spec.embeddedTextPattern
        : DEFAULT_PARSER_SPEC.embeddedTextPattern;
    const fallbackScorePattern = typeof spec.fallbackScorePattern === "string"
        ? spec.fallbackScorePattern
        : DEFAULT_PARSER_SPEC.fallbackScorePattern;

    return {
        titleSuffixPattern,
        embeddedTextPattern,
        fallbackScorePattern,
        titleSuffixRegex: buildSpecPattern(titleSuffixPattern, DEFAULT_PARSER_SPEC.titleSuffixPattern, "i"),
        embeddedTextRegex: buildSpecPattern(embeddedTextPattern, DEFAULT_PARSER_SPEC.embeddedTextPattern, "i"),
        fallbackScoreRegex: buildSpecPattern(fallbackScorePattern, DEFAULT_PARSER_SPEC.fallbackScorePattern, "i"),
        notFoundPatterns,
        riskBands: normalizeRiskBands(spec.riskBands),
        scoreImageHashes
    };
}

async function loadParserSpec() {
    if (parserSpecPromise) {
        return parserSpecPromise;
    }

    parserSpecPromise = (async () => {
        try {
            const response = await fetch(getRuntimeUrl(SPEC_RESOURCE_PATH));
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const rawSpec = await response.json();
            return normalizeParserSpec(rawSpec);
        } catch {
            return normalizeParserSpec(DEFAULT_PARSER_SPEC);
        }
    })();

    return parserSpecPromise;
}

function scoreToRiskLevel(score, spec) {
    for (const band of spec.riskBands) {
        if (score >= band.min) {
            return {
                level: band.level,
                label: band.label
            };
        }
    }

    return { level: "medium", label: "判定" };
}

function decodeEmbeddedWidgetSnippets(rawHtml) {
    const snippets = [];
    const scriptPattern = /window\[_0x\]\((['"])([^'"]+)\1\)/gi;

    if (typeof atob !== "function") {
        return snippets;
    }

    let scriptMatch = null;
    while ((scriptMatch = scriptPattern.exec(rawHtml)) !== null) {
        const scriptPayload = scriptMatch?.[2];
        if (!scriptPayload) {
            continue;
        }

        try {
            const stage1 = atob(scriptPayload);
            const stage2Match = stage1.match(/var\s+\w+\s*=\s*(['"])([^'"]+)\1/i);
            const stage2Payload = stage2Match?.[2];
            if (!stage2Payload) {
                continue;
            }

            const stage2 = atob(stage2Payload);
            const decoded = (() => {
                try {
                    return decodeURIComponent(stage2);
                } catch {
                    return stage2;
                }
            })();

            snippets.push(decoded);
        } catch {
            // malformed payloads are ignored.
        }
    }

    return snippets;
}

function base64ToUint8Array(base64Payload) {
    const binary = atob(base64Payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function sha256Hex(base64Payload) {
    if (typeof atob !== "function" || typeof crypto?.subtle?.digest !== "function") {
        return null;
    }

    const bytes = base64ToUint8Array(base64Payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
}

function clampScore(score) {
    return Math.max(0, Math.min(100, score));
}

function buildSpecPattern(pattern, fallbackPattern, flags) {
    try {
        return new RegExp(pattern, flags);
    } catch {
        // primary pattern invalid — try fallback
    }
    try {
        return new RegExp(fallbackPattern, flags);
    } catch {
        return null;
    }
}

function makeOkResult({ asin, title, score, riskLevel, riskLabel, sourceUrl }) {
    return {
        status: "ok",
        asin,
        title: title || `ASIN ${asin}`,
        score,
        riskLevel,
        riskLabel,
        sourceUrl,
        fetchedAt: new Date().toISOString()
    };
}

function makeNotFoundResult({ asin, title, sourceUrl }) {
    return {
        status: "not_found",
        asin,
        title: title || `ASIN ${asin}`,
        sourceUrl,
        fetchedAt: new Date().toISOString()
    };
}

function isNativeResultPayload(payload, expectedAsin) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return false;
    }

    const isStr = (v) => typeof v === "string" && v.trim().length > 0;
    const isTs = (v) => isStr(v) && !Number.isNaN(Date.parse(v));

    if (normalizeAsin(payload.asin) !== expectedAsin) return false;
    if (!isStr(payload.sourceUrl) || !isTs(payload.fetchedAt)) return false;

    if (payload.status === "ok") {
        return isStr(payload.title) && Number.isFinite(payload.score)
            && isStr(payload.riskLevel) && isStr(payload.riskLabel);
    }
    if (payload.status === "not_found") {
        return isStr(payload.title);
    }
    if (payload.status === "error") {
        return isStr(payload.message) && isStr(payload.errorType)
            && (payload.details === undefined || isStr(payload.details));
    }
    return false;
}

async function parseScoreFromEmbeddedWidgets(rawHtml, spec) {
    const snippets = decodeEmbeddedWidgetSnippets(rawHtml);
    const scoreImageHashes = new Map(Object.entries(spec.scoreImageHashes));

    for (const snippet of snippets) {
        const sakuraIndex = snippet.search(/sakura-num/i);
        if (sakuraIndex >= 0) {
            const tail = snippet.slice(sakuraIndex);
            const imageMatches = tail.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/gi);
            for (const imageMatch of imageMatches) {
                const payload = imageMatch?.[1];
                if (!payload) {
                    continue;
                }

                try {
                    const digest = await sha256Hex(payload);
                    if (digest && scoreImageHashes.has(digest)) {
                        return clampScore(scoreImageHashes.get(digest));
                    }
                } catch {
                    // hashing failure should not abort parsing.
                }
            }
        }

        const textScoreMatch = spec.embeddedTextRegex ? snippet.match(spec.embeddedTextRegex) : null;
        if (textScoreMatch?.[1]) {
            const parsed = Number.parseInt(textScoreMatch[1], 10);
            if (!Number.isNaN(parsed)) {
                return clampScore(parsed);
            }
        }
    }

    return null;
}

function makeErrorResult({ asin, sourceUrl, message, errorType, details }) {
    const result = {
        status: "error",
        asin,
        sourceUrl,
        fetchedAt: new Date().toISOString(),
        message,
        errorType
    };

    if (typeof details === "string" && details.trim().length > 0) {
        result.details = details.trim();
    }

    return result;
}

function extractTitleFromHtml(compactText, spec) {
    const titleMatch = compactText.match(TITLE_TAG_PATTERN);
    const rawTitle = titleMatch?.[1] ?? "";
    const title = decodeHtmlEntities(rawTitle);

    return spec.titleSuffixRegex
        ? title.replace(spec.titleSuffixRegex, "").trim()
        : title.trim();
}

function parseFallbackScore(compactText, spec) {
    const fallbackMatch = spec.fallbackScoreRegex ? compactText.match(spec.fallbackScoreRegex) : null;
    if (!fallbackMatch?.[1]) {
        return null;
    }

    const parsed = Number.parseInt(fallbackMatch[1], 10);
    return Number.isNaN(parsed) ? null : clampScore(parsed);
}

function matchesNotFoundPattern(compactText, patterns) {
    return patterns.some((pattern) => {
        try {
            return new RegExp(pattern, "i").test(compactText);
        } catch {
            return compactText.includes(pattern);
        }
    });
}

function getFreshCachedResult(asin, now = Date.now()) {
    const entry = resultCache.get(asin);
    return entry && (now - entry.timestamp) < CACHE_TTL_MS ? entry.result : null;
}

function pruneExpiredCacheEntries(now = Date.now()) {
    for (const [key, entry] of resultCache) {
        if ((now - entry.timestamp) >= CACHE_TTL_MS) {
            resultCache.delete(key);
        }
    }
}

function evictOldestCacheEntries(maxSize = MAX_CACHE_SIZE) {
    while (resultCache.size >= maxSize) {
        const oldestKey = resultCache.keys().next().value;
        if (typeof oldestKey === "undefined") {
            return;
        }
        resultCache.delete(oldestKey);
    }
}

function cacheResult(asin, result, now = Date.now()) {
    pruneExpiredCacheEntries(now);

    resultCache.delete(asin);
    evictOldestCacheEntries(MAX_CACHE_SIZE);
    resultCache.set(asin, { timestamp: now, result });
    return result;
}

function clearResultCache() {
    resultCache.clear();
}

async function parseSakuraCheckerHtml(html, asin, sourceUrl, specOverride = null) {
    const spec = specOverride ? normalizeParserSpec(specOverride) : await loadParserSpec();
    const rawHtml = String(html ?? "");
    const compactText = rawHtml.replace(/\s+/g, " ");
    const title = extractTitleFromHtml(compactText, spec);

    let score = await parseScoreFromEmbeddedWidgets(rawHtml, spec);

    if (score === null) {
        score = parseFallbackScore(compactText, spec);
    }

    if (score === null) {
        if (matchesNotFoundPattern(compactText, spec.notFoundPatterns)) {
            return makeNotFoundResult({ asin, title, sourceUrl });
        }

        return makeErrorResult({
            asin,
            sourceUrl,
            message: "判定データを解析できませんでした。",
            errorType: "parse_error"
        });
    }

    const riskBaseScore = score <= 10 ? score * 10 : score;
    const risk = scoreToRiskLevel(riskBaseScore, spec);

    return makeOkResult({
        asin,
        title,
        score,
        riskLevel: risk.level,
        riskLabel: risk.label,
        sourceUrl
    });
}

async function fetchViaNativeHost(asin) {
    const sourceUrl = buildSourceUrl(asin);

    if (typeof browser?.runtime?.sendNativeMessage !== "function") {
        return makeErrorResult({
            asin,
            sourceUrl,
            message: "ネイティブ連携が利用できません。",
            errorType: "native_error"
        });
    }

    try {
        const response = await browser.runtime.sendNativeMessage(NATIVE_APP_ID, {
            type: "FETCH_SAKURA_RESULT",
            asin
        });

        if (!isNativeResultPayload(response, asin)) {
            return makeErrorResult({
                asin,
                sourceUrl,
                message: "ネイティブ応答が不正です。",
                errorType: "native_error"
            });
        }

        return response;
    } catch (error) {
        return makeErrorResult({
            asin,
            sourceUrl,
            message: "ネイティブ経由の取得に失敗しました。",
            errorType: "native_error",
            details: String(error?.message ?? error ?? "unknown")
        });
    }
}

async function fetchSakuraCheckerResult(asin) {
    const cachedResult = getFreshCachedResult(asin);
    if (cachedResult) {
        return cachedResult;
    }

    const nativeResult = await fetchViaNativeHost(asin);
    if (nativeResult && nativeResult.status !== "error") {
        return cacheResult(asin, nativeResult);
    }

    const sourceUrl = buildSourceUrl(asin);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(sourceUrl, {
            method: "GET",
            signal: controller.signal,
            headers: {
                accept: "text/html,application/xhtml+xml",
                "accept-language": "ja,en-US;q=0.9"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const result = await parseSakuraCheckerHtml(html, asin, sourceUrl);
        return cacheResult(asin, result);
    } catch (error) {
        const result = makeErrorResult({
            asin,
            sourceUrl,
            message: error?.name === "AbortError"
                ? "判定サービスへの接続がタイムアウトしました。"
                : "判定サービスの取得に失敗しました。",
            errorType: "network_error",
            details: String(error?.message ?? error ?? "").trim() || nativeResult?.details
        });

        return cacheResult(asin, result);
    } finally {
        clearTimeout(timeoutId);
    }
}

if (typeof browser !== "undefined" && browser?.runtime?.onMessage?.addListener) {
    browser.runtime.onMessage.addListener((request) => {
        if (request?.type !== "GET_SAKURA_RESULT") {
            return undefined;
        }

        const asin = normalizeAsin(request.asin);
        if (!asin) {
            return Promise.resolve(makeErrorResult({
                asin: "",
                sourceUrl: "",
                message: "ASINの形式が正しくありません。",
                errorType: "validation_error"
            }));
        }

        return fetchSakuraCheckerResult(asin);
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DEFAULT_PARSER_SPEC,
        buildSourceUrl,
        buildSpecPattern,
        cacheResult,
        clampScore,
        clearResultCache,
        decodeEmbeddedWidgetSnippets,
        extractTitleFromHtml,
        fetchSakuraCheckerResult,
        fetchViaNativeHost,
        getFreshCachedResult,
        makeErrorResult,
        makeNotFoundResult,
        makeOkResult,
        matchesNotFoundPattern,
        normalizeAsin,
        normalizeParserSpec,
        parseFallbackScore,
        parseSakuraCheckerHtml,
        parseScoreFromEmbeddedWidgets,
        scoreToRiskLevel
    };
}
