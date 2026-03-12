# Sakura Extension Message Contract

## Versioning policy
- This contract is backward compatible within the same app version line.
- Removing existing keys is forbidden.
- New optional keys may be added.

## Content script -> background request
```json
{
  "type": "GET_SAKURA_RESULT",
  "asin": "B000000000"
}
```

## Background -> native request
```json
{
  "type": "FETCH_SAKURA_RESULT",
  "asin": "B000000000"
}
```

## Response schema

### Success
```json
{
  "status": "ok",
  "asin": "B000000000",
  "score": 42,
  "riskLevel": "medium",
  "riskLabel": "やや注意",
  "title": "Product title",
  "sourceUrl": "https://sakura-checker.jp/search/B000000000/",
  "fetchedAt": "2026-02-16T00:00:00.000Z"
}
```

### Not found
```json
{
  "status": "not_found",
  "asin": "B000000000",
  "title": "Product title",
  "sourceUrl": "https://sakura-checker.jp/search/B000000000/",
  "fetchedAt": "2026-02-16T00:00:00.000Z"
}
```

### Error
```json
{
  "status": "error",
  "asin": "B000000000",
  "sourceUrl": "https://sakura-checker.jp/search/B000000000/",
  "fetchedAt": "2026-02-16T00:00:00.000Z",
  "message": "判定サービスの取得に失敗しました。",
  "errorType": "network_error",
  "details": "HTTP 503"
}
```

## Error type meanings
- `validation_error`: invalid request shape or invalid ASIN.
- `native_error`: native host communication failed.
- `network_error`: HTTP or timeout failure while fetching source page.
- `parse_error`: source HTML changed and score parsing failed.
