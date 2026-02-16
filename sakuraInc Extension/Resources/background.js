const REQUEST_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const NATIVE_APP_ID = "com.fkmstk.sakuraInc.Extension";

const resultCache = new Map();

function normalizeAsin(rawValue) {
    const value = String(rawValue ?? "").trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(value) ? value : null;
}

function decodeHtmlEntities(text) {
    const entities = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": "\"",
        "&#39;": "'"
    };

    return String(text ?? "").replace(/&(amp|lt|gt|quot|#39);/g, (match) => entities[match] ?? match);
}

function scoreToRiskLevel(score) {
    if (score >= 80) {
        return { level: "very-high", label: "危険" };
    }

    if (score >= 60) {
        return { level: "high", label: "注意" };
    }

    if (score >= 40) {
        return { level: "medium", label: "やや注意" };
    }

    if (score >= 20) {
        return { level: "low", label: "低め" };
    }

    return { level: "very-low", label: "低リスク" };
}

function parseSakuraCheckerHtml(html, asin, sourceUrl) {
    const rawHtml = String(html ?? "");
    const compactText = rawHtml.replace(/\s+/g, " ");

    const titleMatch = compactText.match(/<title>(.*?)<\/title>/i);
    const rawTitle = titleMatch?.[1] ?? "";
    const title = decodeHtmlEntities(rawTitle).replace(/\s*-\s*サクラチェッカー.*$/i, "").trim();

    const scorePatterns = [
        /サクラ度[^0-9]{0,20}([0-9]{1,3})\s*%/i,
        /危険度[^0-9]{0,20}([0-9]{1,3})\s*%/i,
        /["']score["']\s*[:=]\s*["']?([0-9]{1,3})["']?/i,
        /data-score=["']?([0-9]{1,3})["']?/i
    ];

    let score = null;

    for (const pattern of scorePatterns) {
        const match = compactText.match(pattern);
        if (match?.[1]) {
            const parsed = Number.parseInt(match[1], 10);
            if (!Number.isNaN(parsed)) {
                score = Math.max(0, Math.min(100, parsed));
                break;
            }
        }
    }

    if (score === null) {
        const notFoundPatterns = [
            /見つかりません/i,
            /データがありません/i,
            /判定できません/i,
            /該当する商品はありません/i
        ];

        const isNotFound = notFoundPatterns.some((pattern) => pattern.test(compactText));
        if (isNotFound) {
            return {
                status: "not_found",
                asin,
                title: title || `ASIN ${asin}`,
                sourceUrl,
                fetchedAt: new Date().toISOString()
            };
        }

        return {
            status: "error",
            asin,
            title: title || `ASIN ${asin}`,
            sourceUrl,
            fetchedAt: new Date().toISOString(),
            message: "サクラチェッカーの判定値を解析できませんでした。"
        };
    }

    const risk = scoreToRiskLevel(score);

    return {
        status: "ok",
        asin,
        title: title || `ASIN ${asin}`,
        score,
        riskLevel: risk.level,
        riskLabel: risk.label,
        sourceUrl,
        fetchedAt: new Date().toISOString()
    };
}

async function fetchSakuraCheckerResult(asin) {
    const cacheHit = resultCache.get(asin);
    if (cacheHit && (Date.now() - cacheHit.timestamp) < CACHE_TTL_MS) {
        return cacheHit.result;
    }

    const nativeResult = await fetchViaNativeHost(asin);
    if (nativeResult && nativeResult.status !== "error") {
        resultCache.set(asin, { timestamp: Date.now(), result: nativeResult });
        return nativeResult;
    }

    const sourceUrl = `https://sakura-checker.jp/search/${encodeURIComponent(asin)}/`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(sourceUrl, {
            method: "GET",
            signal: controller.signal,
            headers: {
                "accept": "text/html,application/xhtml+xml",
                "accept-language": "ja,en-US;q=0.9"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const result = parseSakuraCheckerHtml(html, asin, sourceUrl);
        resultCache.set(asin, { timestamp: Date.now(), result });
        return result;
    } catch (error) {
        const details = String(error?.message ?? error ?? "").trim();
        const nativeError = nativeResult?.message ? ` / native: ${nativeResult.message}` : "";
        const result = {
            status: "error",
            asin,
            sourceUrl,
            fetchedAt: new Date().toISOString(),
            message: error?.name === "AbortError"
                ? "サクラチェッカーへの接続がタイムアウトしました。"
                : "サクラチェッカーの取得に失敗しました。",
            details: `${details}${nativeError}`.trim()
        };

        resultCache.set(asin, { timestamp: Date.now(), result });
        return result;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchViaNativeHost(asin) {
    if (typeof browser?.runtime?.sendNativeMessage !== "function") {
        return null;
    }

    try {
        const response = await browser.runtime.sendNativeMessage(NATIVE_APP_ID, {
            type: "FETCH_SAKURA_RESULT",
            asin
        });

        if (!response || typeof response !== "object") {
            return {
                status: "error",
                asin,
                message: "ネイティブ応答が不正です。"
            };
        }

        return response;
    } catch (error) {
        return {
            status: "error",
            asin,
            message: `ネイティブ取得失敗: ${String(error?.message ?? error ?? "unknown")}`
        };
    }
}

browser.runtime.onMessage.addListener((request) => {
    if (request?.type !== "GET_SAKURA_RESULT") {
        return undefined;
    }

    const asin = normalizeAsin(request.asin);
    if (!asin) {
        return Promise.resolve({
            status: "error",
            message: "ASINの形式が正しくありません。"
        });
    }

    return fetchSakuraCheckerResult(asin);
});
