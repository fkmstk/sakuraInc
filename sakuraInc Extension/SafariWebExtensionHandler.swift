import Foundation
import SafariServices
import os.log

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let requestTimeout: TimeInterval = 15
    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private lazy var urlSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.requestTimeout
        configuration.timeoutIntervalForResource = Self.requestTimeout + 5
        return URLSession(configuration: configuration)
    }()

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(
            .default,
            "Received native message: %@ (profile: %@)",
            String(describing: message),
            profile?.uuidString ?? "none"
        )

        guard let payload = message as? [String: Any],
              let type = payload["type"] as? String,
              type == "FETCH_SAKURA_RESULT" else {
            complete(context: context, payload: [
                "status": "error",
                "message": "Unsupported native message type."
            ])
            return
        }

        guard let asinRaw = payload["asin"] as? String,
              let asin = normalizeAsin(asinRaw) else {
            complete(context: context, payload: [
                "status": "error",
                "message": "ASINの形式が正しくありません。"
            ])
            return
        }

        fetchSakuraCheckerResult(asin: asin) { [weak self] result in
            guard let self else { return }
            self.complete(context: context, payload: result)
        }
    }

    private func complete(context: NSExtensionContext, payload: [String: Any]) {
        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: payload]
        } else {
            response.userInfo = ["message": payload]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func normalizeAsin(_ rawValue: String) -> String? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let range = value.range(of: "^[A-Z0-9]{10}$", options: .regularExpression)
        return range == nil ? nil : value
    }

    private func fetchSakuraCheckerResult(asin: String, completion: @escaping ([String: Any]) -> Void) {
        let sourceUrl = "https://sakura-checker.jp/search/\(asin)/"
        guard let url = URL(string: sourceUrl) else {
            completion(makeErrorResult(
                asin: asin,
                sourceUrl: sourceUrl,
                message: "URL生成に失敗しました。"
            ))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        request.setValue("ja,en-US;q=0.9", forHTTPHeaderField: "Accept-Language")

        urlSession.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }

            if let error {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "サクラチェッカーの取得に失敗しました。",
                    details: error.localizedDescription
                ))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "HTTPレスポンスを取得できませんでした。"
                ))
                return
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "サクラチェッカーの取得に失敗しました。",
                    details: "HTTP \(httpResponse.statusCode)"
                ))
                return
            }

            guard let data else {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "レスポンス本文が空です。"
                ))
                return
            }

            let html =
                String(data: data, encoding: .utf8) ??
                String(data: data, encoding: .japaneseEUC) ??
                String(data: data, encoding: .shiftJIS)

            guard let html else {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "HTMLの文字コードを解釈できませんでした。"
                ))
                return
            }

            completion(self.parseSakuraCheckerHtml(html: html, asin: asin, sourceUrl: sourceUrl))
        }.resume()
    }

    private func parseSakuraCheckerHtml(html: String, asin: String, sourceUrl: String) -> [String: Any] {
        let compact = html.replacingOccurrences(
            of: "\\s+",
            with: " ",
            options: .regularExpression
        )
        let rawTitle = firstCapture(in: compact, pattern: "<title>(.*?)</title>") ?? ""
        let title = decodeHtmlEntities(rawTitle)
            .replacingOccurrences(of: "\\s*-\\s*サクラチェッカー.*$", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let scorePatterns = [
            "サクラ度[^0-9]{0,20}([0-9]{1,3})\\s*%",
            "危険度[^0-9]{0,20}([0-9]{1,3})\\s*%",
            "[\"']score[\"']\\s*[:=]\\s*[\"']?([0-9]{1,3})[\"']?",
            "data-score=[\"']?([0-9]{1,3})[\"']?"
        ]

        var score: Int?
        for pattern in scorePatterns {
            guard let rawScore = firstCapture(in: compact, pattern: pattern),
                  let parsed = Int(rawScore) else {
                continue
            }
            score = min(max(parsed, 0), 100)
            break
        }

        if let score {
            let risk = scoreToRisk(score: score)
            return [
                "status": "ok",
                "asin": asin,
                "title": title.isEmpty ? "ASIN \(asin)" : title,
                "score": score,
                "riskLevel": risk.level,
                "riskLabel": risk.label,
                "sourceUrl": sourceUrl,
                "fetchedAt": nowIsoString()
            ]
        }

        let notFoundPatterns = [
            "見つかりません",
            "データがありません",
            "判定できません",
            "該当する商品はありません"
        ]

        let isNotFound = notFoundPatterns.contains { pattern in
            compact.range(of: pattern, options: .regularExpression) != nil
        }

        if isNotFound {
            return [
                "status": "not_found",
                "asin": asin,
                "title": title.isEmpty ? "ASIN \(asin)" : title,
                "sourceUrl": sourceUrl,
                "fetchedAt": nowIsoString()
            ]
        }

        return makeErrorResult(
            asin: asin,
            sourceUrl: sourceUrl,
            message: "サクラチェッカーの判定値を解析できませんでした。"
        )
    }

    private func firstCapture(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }

        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              match.numberOfRanges > 1,
              let captureRange = Range(match.range(at: 1), in: text) else {
            return nil
        }

        return String(text[captureRange])
    }

    private func decodeHtmlEntities(_ text: String) -> String {
        let map: [String: String] = [
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": "\"",
            "&#39;": "'"
        ]

        return map.reduce(text) { partialResult, item in
            partialResult.replacingOccurrences(of: item.key, with: item.value)
        }
    }

    private func nowIsoString() -> String {
        Self.isoFormatter.string(from: Date())
    }

    private func scoreToRisk(score: Int) -> (level: String, label: String) {
        if score >= 80 { return ("very-high", "危険") }
        if score >= 60 { return ("high", "注意") }
        if score >= 40 { return ("medium", "やや注意") }
        if score >= 20 { return ("low", "低め") }
        return ("very-low", "低リスク")
    }

    private func makeErrorResult(
        asin: String,
        sourceUrl: String,
        message: String,
        details: String? = nil
    ) -> [String: Any] {
        var result: [String: Any] = [
            "status": "error",
            "asin": asin,
            "sourceUrl": sourceUrl,
            "fetchedAt": nowIsoString(),
            "message": message
        ]

        if let details, details.isEmpty == false {
            result["details"] = details
        }

        return result
    }
}
