const test = require('node:test');
const assert = require('node:assert/strict');

const content = require('../sakuraInc Extension/Resources/content.js');

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
