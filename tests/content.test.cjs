const test = require('node:test');
const assert = require('node:assert/strict');

const content = require('../sakuraInc Extension/Resources/content.js');

test('normalizeAsinCandidate trims and uppercases valid values', () => {
  assert.equal(content.normalizeAsinCandidate(' b0abc12345 '), 'B0ABC12345');
  assert.equal(content.normalizeAsinCandidate('B0ABC1234'), null);
  assert.equal(content.normalizeAsinCandidate(''), null);
});

test('extractAsinFromUrl handles 10 URL patterns', () => {
  const cases = [
    ['https://www.amazon.co.jp/dp/B012345678', 'B012345678'],
    ['https://www.amazon.co.jp/dp/B012345678/', 'B012345678'],
    ['https://www.amazon.co.jp/dp/B012345678?th=1', 'B012345678'],
    ['https://www.amazon.com/gp/product/B0ABCDE123', 'B0ABCDE123'],
    ['https://www.amazon.com/gp/product/B0ABCDE123/ref=something', 'B0ABCDE123'],
    ['https://www.amazon.co.jp/product/B0AZBYCXDW', 'B0AZBYCXDW'],
    ['https://www.amazon.co.jp/dp/b0abc123de', 'B0ABC123DE'],
    ['https://example.com/dp/B012345678', 'B012345678'],
    ['https://www.amazon.co.jp/dp/B01234', null],
    ['https://www.amazon.co.jp/s?k=B012345678', null]
  ];

  for (const [url, expected] of cases) {
    assert.equal(content.extractAsinFromUrl(url), expected);
  }
});

test('extractAsinFromDom finds ASIN from DOM attributes', () => {
  const originalDocument = global.document;

  global.document = {
    querySelector: (selector) => {
      if (selector === '#ASIN') {
        return {
          getAttribute: (name) => (name === 'value' ? 'B0DOM11111' : null),
          dataset: {},
          textContent: ''
        };
      }
      return null;
    }
  };

  assert.equal(content.extractAsinFromDom(), 'B0DOM11111');
  global.document = originalDocument;
});

test('extractAsinFromDom falls back to data attributes and text content', () => {
  const originalDocument = global.document;
  const elements = {
    '#ASIN': null,
    "input[name='ASIN']": {
      getAttribute: (name) => (name === 'value' ? 'invalid' : null),
      dataset: {},
      textContent: ''
    },
    "input[name='asin']": {
      getAttribute: (name) => (name === 'data-asin' ? ' b0dom22222 ' : null),
      dataset: {},
      textContent: ''
    },
    '[data-asin]': {
      getAttribute: () => null,
      dataset: { asin: 'not-used' },
      textContent: 'b0dom33333'
    }
  };

  global.document = {
    querySelector: (selector) => elements[selector] ?? null
  };

  assert.equal(content.extractAsinFromDom(), 'B0DOM22222');
  global.document = originalDocument;
});
