const test = require('node:test');
const assert = require('node:assert/strict');

const originalBrowser = global.browser;
const originalFetch = global.fetch;

global.browser = {
  runtime: {
    onMessage: { addListener: () => {} }
  }
};

const background = require('../sakuraInc Extension/Resources/background.js');
const spec = background.normalizeParserSpec(background.DEFAULT_PARSER_SPEC);

test.beforeEach(() => {
  background.clearResultCache?.();
  global.fetch = originalFetch;
  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} }
    }
  };
});

test('normalizeAsin validates 10-char ASIN', () => {
  assert.equal(background.normalizeAsin('b0abc12345'), 'B0ABC12345');
  assert.equal(background.normalizeAsin('B0ABC1234'), null);
  assert.equal(background.normalizeAsin('B0ABC123456'), null);
});

test('parseSakuraCheckerHtml parses 20 score fixtures', async () => {
  const sourceUrl = 'https://sakura-checker.jp/search/B000000001/';
  const asin = 'B000000001';
  const scores = Array.from({ length: 20 }, (_, idx) => idx * 5);

  for (const score of scores) {
    const html = `
      <html><head><title>Test Item - サクラチェッカー</title></head>
      <body><p class="sakura-alert">サクラ度は ${score} % です</p></body>
      </html>
    `;

    const parsed = await background.parseSakuraCheckerHtml(html, asin, sourceUrl, spec);
    assert.equal(parsed.status, 'ok');
    assert.equal(parsed.score, score);
    assert.equal(parsed.asin, asin);
    assert.ok(typeof parsed.fetchedAt === 'string');
  }
});

test('parseSakuraCheckerHtml returns not_found', async () => {
  const html = '<html><body>該当する商品はありません</body></html>';
  const parsed = await background.parseSakuraCheckerHtml(html, 'B000000002', 'https://sakura-checker.jp/search/B000000002/', spec);
  assert.equal(parsed.status, 'not_found');
});

test('parseSakuraCheckerHtml returns parse_error for unknown HTML', async () => {
  const html = '<html><body><div>unexpected format</div></body></html>';
  const parsed = await background.parseSakuraCheckerHtml(html, 'B000000003', 'https://sakura-checker.jp/search/B000000003/', spec);
  assert.equal(parsed.status, 'error');
  assert.equal(parsed.errorType, 'parse_error');
});

test('parseSakuraCheckerHtml falls back to literal match for invalid notFound regex', async () => {
  const customSpec = background.normalizeParserSpec({
    ...background.DEFAULT_PARSER_SPEC,
    notFoundPatterns: ['[invalid', '該当する商品はありません']
  });
  const html = '<html><body>該当する商品はありません</body></html>';

  const parsed = await background.parseSakuraCheckerHtml(
    html,
    'B000000004',
    'https://sakura-checker.jp/search/B000000004/',
    customSpec
  );

  assert.equal(parsed.status, 'not_found');
});

test('parseSakuraCheckerHtml falls back to default regexes when spec patterns are malformed', async () => {
  const customSpec = background.normalizeParserSpec({
    ...background.DEFAULT_PARSER_SPEC,
    titleSuffixPattern: '[',
    embeddedTextPattern: '(',
    fallbackScorePattern: '['
  });
  const html = `
    <html><head><title>Broken Spec Item - サクラチェッカー</title></head>
    <body><p class="sakura-alert">サクラ度は 35 % です</p></body>
    </html>
  `;

  const parsed = await background.parseSakuraCheckerHtml(
    html,
    'B000000005',
    'https://sakura-checker.jp/search/B000000005/',
    customSpec
  );

  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.title, 'Broken Spec Item');
  assert.equal(parsed.score, 35);
});

test('fetchViaNativeHost returns native_error when sendNativeMessage is unavailable', async () => {
  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} }
    }
  };

  const result = await background.fetchViaNativeHost('B000000010');
  assert.equal(result.status, 'error');
  assert.equal(result.errorType, 'native_error');
  assert.equal(result.sourceUrl, 'https://sakura-checker.jp/search/B000000010/');
});

test('fetchViaNativeHost returns native_error for invalid native responses', async () => {
  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => 'invalid'
    }
  };

  const result = await background.fetchViaNativeHost('B000000011');
  assert.equal(result.status, 'error');
  assert.equal(result.errorType, 'native_error');
});

test('fetchViaNativeHost rejects object responses without status', async () => {
  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => ({ score: 50 })
    }
  };

  const result = await background.fetchViaNativeHost('B000000017');
  assert.equal(result.status, 'error');
  assert.equal(result.errorType, 'native_error');
});

test('fetchViaNativeHost rejects ok responses missing required fields', async () => {
  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => ({ status: 'ok', asin: 'B000000018' })
    }
  };

  const result = await background.fetchViaNativeHost('B000000018');
  assert.equal(result.status, 'error');
  assert.equal(result.errorType, 'native_error');
});

test('fetchViaNativeHost includes details when native messaging throws', async () => {
  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => {
        throw new Error('native failed');
      }
    }
  };

  const result = await background.fetchViaNativeHost('B000000012');
  assert.equal(result.status, 'error');
  assert.equal(result.errorType, 'native_error');
  assert.equal(result.details, 'native failed');
});

test('fetchSakuraCheckerResult returns fresh cache without calling native or fetch', async () => {
  const asin = 'B000000013';
  let nativeCalls = 0;
  let fetchCalls = 0;

  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => {
        nativeCalls += 1;
        return {
          status: 'ok',
          asin,
          title: 'Cached native result',
          score: 55,
          riskLevel: 'medium',
          riskLabel: 'やや注意',
          sourceUrl: background.buildSourceUrl(asin),
          fetchedAt: '2026-03-13T00:00:00.000Z'
        };
      }
    }
  };

  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not run');
  };

  const first = await background.fetchSakuraCheckerResult(asin);
  const second = await background.fetchSakuraCheckerResult(asin);

  assert.equal(first.status, 'ok');
  assert.deepEqual(second, first);
  assert.equal(nativeCalls, 1);
  assert.equal(fetchCalls, 0);
});

test('fetchSakuraCheckerResult caches successful native results', async () => {
  const asin = 'B000000014';
  let nativeCalls = 0;

  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => {
        nativeCalls += 1;
        return {
          status: 'ok',
          asin,
          title: 'Native success',
          score: 80,
          riskLevel: 'very-high',
          riskLabel: '危険',
          sourceUrl: background.buildSourceUrl(asin),
          fetchedAt: '2026-03-13T00:00:00.000Z'
        };
      }
    }
  };

  global.fetch = async () => {
    throw new Error('fetch should not run');
  };

  const result = await background.fetchSakuraCheckerResult(asin);
  assert.equal(result.status, 'ok');
  assert.equal(result.title, 'Native success');
  assert.equal(nativeCalls, 1);
});

test('cacheResult evicts the oldest fresh entry when cache hits max size', () => {
  const now = Date.now();

  for (let index = 0; index <= 200; index += 1) {
    const asin = `B${String(index).padStart(9, '0')}`;
    background.cacheResult(asin, {
      status: 'ok',
      asin,
      title: `Item ${index}`,
      score: index % 100,
      riskLevel: 'medium',
      riskLabel: 'やや注意',
      sourceUrl: background.buildSourceUrl(asin),
      fetchedAt: '2026-03-13T00:00:00.000Z'
    }, now);
  }

  assert.equal(background.getFreshCachedResult('B000000000', now), null);
  assert.equal(background.getFreshCachedResult('B000000001', now)?.asin, 'B000000001');
  assert.equal(background.getFreshCachedResult('B000000200', now)?.asin, 'B000000200');
});

test('fetchSakuraCheckerResult falls back to HTTP fetch after native error', async () => {
  const asin = 'B000000015';
  let nativeCalls = 0;
  let fetchCalls = 0;

  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => {
        nativeCalls += 1;
        throw new Error('native offline');
      }
    }
  };

  global.fetch = async (url) => {
    if (url === background.buildSourceUrl(asin)) {
      fetchCalls += 1;
      return {
        ok: true,
        text: async () => `
          <html><head><title>Fetched Item - サクラチェッカー</title></head>
          <body><p class="sakura-alert">サクラ度は 65 % です</p></body>
          </html>
        `
      };
    }

    return {
      ok: true,
      json: async () => background.DEFAULT_PARSER_SPEC
    };
  };

  const result = await background.fetchSakuraCheckerResult(asin);
  assert.equal(result.status, 'ok');
  assert.equal(result.score, 65);
  assert.equal(result.title, 'Fetched Item');
  assert.equal(nativeCalls, 1);
  assert.equal(fetchCalls, 1);
});

test('fetchSakuraCheckerResult returns network_error and caches failures', async () => {
  const asin = 'B000000016';
  let nativeCalls = 0;
  let fetchCalls = 0;
  const abortError = new Error('timed out');
  abortError.name = 'AbortError';

  global.browser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendNativeMessage: async () => {
        nativeCalls += 1;
        return {
          status: 'error',
          errorType: 'native_error',
          details: 'native down'
        };
      }
    }
  };

  global.fetch = async () => {
    fetchCalls += 1;
    throw abortError;
  };

  const first = await background.fetchSakuraCheckerResult(asin);
  const second = await background.fetchSakuraCheckerResult(asin);

  assert.equal(first.status, 'error');
  assert.equal(first.errorType, 'network_error');
  assert.equal(first.message, '判定サービスへの接続がタイムアウトしました。');
  assert.equal(first.details, 'timed out');
  assert.deepEqual(second, first);
  assert.equal(nativeCalls, 1);
  assert.equal(fetchCalls, 1);
});

test.after(() => {
  background.clearResultCache?.();
  global.fetch = originalFetch;
  global.browser = originalBrowser;
});
