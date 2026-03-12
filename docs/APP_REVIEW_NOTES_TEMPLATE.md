# App Review Notes Template

## Purpose
This app shows external review reference scores for product pages in Safari.

## How it works
1. User opens a supported product detail page.
2. Extension extracts ASIN from the page.
3. Extension fetches the corresponding score page from the external source.
4. Extension shows score/risk badge and source-page link.

## Privacy
- No login.
- No payment.
- No tracking.
- The app sends only ASIN value to fetch source result.

## Fallback behavior
If score parsing fails or network fails, the extension keeps a link to open the source page directly.

## Permission explanation
- `nativeMessaging`: used for native host communication in Safari Web Extension.
- Host access is restricted to `*.sakura-checker.jp`.

## Third-party permission
Attach evidence/document proving permission to use and display source results.
