const PANEL_ID = "sakura-checker-result-panel";
const STYLE_ID = "sakura-checker-result-style";

function extractAsinFromUrl(urlValue) {
    const url = String(urlValue ?? "");
    const patterns = [
        /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
        /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
            return match[1].toUpperCase();
        }
    }

    return null;
}

function extractAsinFromDom() {
    if (typeof document === "undefined") {
        return null;
    }

    const selectors = [
        "#ASIN",
        "input[name='ASIN']",
        "input[name='asin']",
        "[data-asin]"
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element) {
            continue;
        }

        const values = [
            element.getAttribute("value"),
            element.getAttribute("data-asin"),
            element.dataset?.asin,
            element.textContent
        ];

        for (const candidate of values) {
            const value = String(candidate ?? "").trim().toUpperCase();
            if (/^[A-Z0-9]{10}$/.test(value)) {
                return value;
            }
        }
    }

    return null;
}

function extractAsin() {
    if (typeof window === "undefined") {
        return null;
    }

    return extractAsinFromUrl(window.location.href) ?? extractAsinFromDom();
}

function ensureStyle() {
    if (typeof document === "undefined") {
        return;
    }

    if (document.getElementById(STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${PANEL_ID} {
            border: 1px solid #e3e6e6;
            border-radius: 8px;
            padding: 12px;
            margin: 12px 0;
            background: #ffffff;
            font-size: 14px;
            line-height: 1.5;
            color: #111111;
            box-shadow: 0 1px 2px rgba(15, 17, 17, 0.1);
            font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
        }

        #${PANEL_ID} .sakura-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        #${PANEL_ID} .sakura-title {
            font-weight: 700;
            font-size: 15px;
        }

        #${PANEL_ID} .sakura-badge {
            display: inline-block;
            font-weight: 700;
            border-radius: 999px;
            padding: 2px 10px;
            color: #ffffff;
            background: #555555;
            font-size: 12px;
        }

        #${PANEL_ID} .sakura-score {
            font-size: 26px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        #${PANEL_ID} .sakura-summary {
            font-size: 13px;
            color: #444444;
            margin-bottom: 8px;
        }

        #${PANEL_ID} .sakura-meta {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #666666;
            gap: 8px;
        }

        #${PANEL_ID} .sakura-link {
            color: #007185;
            text-decoration: none;
        }

        #${PANEL_ID} .sakura-link:hover {
            text-decoration: underline;
        }

        #${PANEL_ID}.sakura-level-very-high .sakura-badge { background: #b12704; }
        #${PANEL_ID}.sakura-level-high .sakura-badge { background: #d65f0e; }
        #${PANEL_ID}.sakura-level-medium .sakura-badge { background: #f0ad4e; color: #222222; }
        #${PANEL_ID}.sakura-level-low .sakura-badge { background: #4a9c56; }
        #${PANEL_ID}.sakura-level-very-low .sakura-badge { background: #237646; }
        #${PANEL_ID}.sakura-neutral .sakura-badge { background: #5f6b7a; }
    `;

    document.head.appendChild(style);
}

function findMountPoint() {
    if (typeof document === "undefined") {
        return null;
    }

    const selectors = [
        "#title_feature_div",
        "#centerCol",
        "#ppd"
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            return element;
        }
    }

    return null;
}

function createPanel(asin) {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "sakura-neutral";
    panel.innerHTML = `
        <div class="sakura-header">
            <div class="sakura-title">サクラ判定</div>
            <span class="sakura-badge">確認中</span>
        </div>
        <div class="sakura-score">...</div>
        <div class="sakura-summary">ASIN ${asin} の判定を取得中だっちゃ。</div>
        <div class="sakura-meta">
            <a class="sakura-link" href="#" target="_blank" rel="noopener noreferrer">判定元ページを開く</a>
            <span class="sakura-time"></span>
        </div>
    `;

    return panel;
}

function formatTime(isoString) {
    if (!isoString) {
        return "";
    }

    try {
        return new Intl.DateTimeFormat("ja-JP", {
            dateStyle: "short",
            timeStyle: "short"
        }).format(new Date(isoString));
    } catch {
        return "";
    }
}

function errorMessageForResult(result) {
    if (result?.errorType === "parse_error") {
        return "判定データ形式の変更により、結果を取得できませんでした。";
    }

    if (result?.errorType === "network_error") {
        return "判定サービスへの接続に失敗しました。しばらくして再試行してほしいっちゃ。";
    }

    return result?.message || "結果の取得に失敗したっちゃ。";
}

function updatePanel(panel, result, asin) {
    const badge = panel.querySelector(".sakura-badge");
    const score = panel.querySelector(".sakura-score");
    const summary = panel.querySelector(".sakura-summary");
    const link = panel.querySelector(".sakura-link");
    const time = panel.querySelector(".sakura-time");

    const sourceUrl = result?.sourceUrl || `https://sakura-checker.jp/search/${asin}/`;
    link.href = sourceUrl;
    time.textContent = result?.fetchedAt ? `更新: ${formatTime(result.fetchedAt)}` : "";

    if (result?.status === "ok") {
        panel.className = `sakura-level-${result.riskLevel ?? "medium"}`;
        badge.textContent = result.riskLabel ?? "判定";
        score.textContent = String(result.score ?? "--");
        summary.textContent = `サクラ度 ${result.score ?? "--"} / ${result.title ?? "判定結果を取得しました。"}`;
        return;
    }

    panel.className = "sakura-neutral";
    score.textContent = "--";
    badge.textContent = "未判定";

    if (result?.status === "not_found") {
        summary.textContent = "この商品は判定元サービス上で未登録みたいだっちゃ。";
        return;
    }

    summary.textContent = errorMessageForResult(result);
}

async function mountPanel() {
    const asin = extractAsin();
    if (!asin) {
        return;
    }

    ensureStyle();
    const mountPoint = findMountPoint();
    if (!mountPoint) {
        return;
    }

    document.getElementById(PANEL_ID)?.remove();

    const panel = createPanel(asin);
    mountPoint.prepend(panel);

    try {
        const result = await browser.runtime.sendMessage({
            type: "GET_SAKURA_RESULT",
            asin
        });
        updatePanel(panel, result, asin);
    } catch {
        updatePanel(panel, {
            status: "error",
            errorType: "network_error",
            message: "判定サービスに接続できませんでした。"
        }, asin);
    }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            void mountPanel();
        });
    } else {
        void mountPanel();
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        errorMessageForResult,
        extractAsin,
        extractAsinFromDom,
        extractAsinFromUrl,
        formatTime
    };
}
