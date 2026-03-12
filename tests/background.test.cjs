const test = require('node:test');
const assert = require('node:assert/strict');

const originalBrowser = global.browser;

global.browser = {
  runtime: {
    onMessage: { addListener: () => {} }
  }
};

const background = require('../sakuraInc Extension/Resources/background.js');
const spec = background.normalizeParserSpec(background.DEFAULT_PARSER_SPEC);

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

test.after(() => {
  global.browser = originalBrowser;
});
