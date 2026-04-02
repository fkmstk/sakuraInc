# App Review Notes

## Purpose
This app displays Sakura Checker reference information for supported product pages in Safari.

## User flow
1. The user opens a supported product page in Safari.
2. The extension extracts the ASIN from the page.
3. The native host fetches the corresponding Sakura Checker page using that ASIN.
4. The extension shows the score, risk label, and a link to open the source page directly.

## Data usage
- No login
- No payment
- No advertising SDK
- No tracking SDK
- Only the ASIN needed to request the source result is sent

## Fallback behavior
If parsing fails or the source service is unavailable, the user can still open the source page directly from the extension UI.

## Permissions
- `nativeMessaging`: required for Safari Web Extension communication with the native app host
- Host access is limited to `*.sakura-checker.jp`

## Third-party permission
Submission should include the latest permission proof for using and displaying the source result.

