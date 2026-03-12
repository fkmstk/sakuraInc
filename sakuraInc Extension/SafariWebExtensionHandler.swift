import Foundation
import SafariServices
import os.log
import CryptoKit

private struct ParserRiskBand: Codable {
    let min: Int
    let level: String
    let label: String
}

private struct SakuraParserSpec: Codable {
    let titleSuffixPattern: String
    let embeddedTextPattern: String
    let fallbackScorePattern: String
    let notFoundPatterns: [String]
    let riskBands: [ParserRiskBand]
    let scoreImageHashes: [String: Int]

    static let `default` = SakuraParserSpec(
        titleSuffixPattern: "\\s*-\\s*サクラチェッカー.*$",
        embeddedTextPattern: "サクラ度は\\s*([0-9]{1,3})\\s*です",
        fallbackScorePattern: "<p[^>]*class=[\\\"'][^\\\"']*sakura-alert[^\\\"']*[\\\"'][^>]*>.*?サクラ度[^0-9]{0,20}([0-9]{1,3})",
        notFoundPatterns: ["見つかりません", "データがありません", "判定できません", "該当する商品はありません"],
        riskBands: [
            ParserRiskBand(min: 80, level: "very-high", label: "危険"),
            ParserRiskBand(min: 60, level: "high", label: "注意"),
            ParserRiskBand(min: 40, level: "medium", label: "やや注意"),
            ParserRiskBand(min: 20, level: "low", label: "低め"),
            ParserRiskBand(min: 0, level: "very-low", label: "低リスク")
        ],
        scoreImageHashes: [:]
    )
}

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let requestTimeout: TimeInterval = 15
    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static func loadParserSpec() -> SakuraParserSpec {
        guard let url = Bundle.main.url(forResource: "sakura_parser_spec", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(SakuraParserSpec.self, from: data) else {
            return .default
        }

        return decoded
    }

    private let parserSpec: SakuraParserSpec = SafariWebExtensionHandler.loadParserSpec()

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
                "message": "Unsupported native message type.",
                "errorType": "validation_error"
            ])
            return
        }

        guard let asinRaw = payload["asin"] as? String,
              let asin = normalizeAsin(asinRaw) else {
            complete(context: context, payload: [
                "status": "error",
                "message": "ASINの形式が正しくありません。",
                "errorType": "validation_error"
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
                message: "URL生成に失敗しました。",
                errorType: "validation_error"
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
                    message: "判定サービスの取得に失敗しました。",
                    errorType: "network_error",
                    details: error.localizedDescription
                ))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "HTTPレスポンスを取得できませんでした。",
                    errorType: "network_error"
                ))
                return
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "判定サービスの取得に失敗しました。",
                    errorType: "network_error",
                    details: "HTTP \(httpResponse.statusCode)"
                ))
                return
            }

            guard let data else {
                completion(self.makeErrorResult(
                    asin: asin,
                    sourceUrl: sourceUrl,
                    message: "レスポンス本文が空です。",
                    errorType: "network_error"
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
                    message: "HTMLの文字コードを解釈できませんでした。",
                    errorType: "parse_error"
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
            .replacingOccurrences(of: parserSpec.titleSuffixPattern, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var score = parseScoreFromEmbeddedWidgets(html: html)

        if score == nil,
           let rawScore = firstCapture(in: compact, pattern: parserSpec.fallbackScorePattern),
           let parsed = Int(rawScore) {
            score = clampScore(parsed)
        }

        if let score {
            let riskBaseScore = score <= 10 ? score * 10 : score
            let risk = scoreToRisk(score: riskBaseScore)
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

        let isNotFound = parserSpec.notFoundPatterns.contains { pattern in
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
            message: "判定データを解析できませんでした。",
            errorType: "parse_error"
        )
    }

    private func parseScoreFromEmbeddedWidgets(html: String) -> Int? {
        for snippet in decodeEmbeddedWidgetSnippets(html: html) {
            if let score = parseScoreFromScoreImage(snippet: snippet) {
                return score
            }

            if let textualScore = firstCapture(
                in: snippet,
                pattern: parserSpec.embeddedTextPattern
            ), let parsed = Int(textualScore) {
                return clampScore(parsed)
            }
        }

        return nil
    }

    private func decodeEmbeddedWidgetSnippets(html: String) -> [String] {
        guard let regex = try? NSRegularExpression(
            pattern: "window\\[_0x\\]\\((?:'|\\\")([^'\\\"]+)(?:'|\\\")\\)",
            options: [.caseInsensitive]
        ) else {
            return []
        }

        let range = NSRange(html.startIndex..., in: html)
        let matches = regex.matches(in: html, options: [], range: range)
        var snippets: [String] = []
        snippets.reserveCapacity(matches.count)

        for match in matches {
            guard match.numberOfRanges > 1,
                  let payloadRange = Range(match.range(at: 1), in: html) else {
                continue
            }

            let payload = String(html[payloadRange])
            guard let stage1 = decodeBase64(payload),
                  let stage2Payload = firstCapture(
                    in: stage1,
                    pattern: "var\\s+\\w+\\s*=\\s*(?:'|\\\")([^'\\\"]+)(?:'|\\\")"
                  ),
                  let stage2 = decodeBase64(stage2Payload) else {
                continue
            }

            let decoded = stage2.removingPercentEncoding ?? stage2
            snippets.append(decoded)
        }

        return snippets
    }

    private func parseScoreFromScoreImage(snippet: String) -> Int? {
        guard let markerRange = snippet.range(of: "sakura-num", options: .caseInsensitive) else {
            return nil
        }

        let tail = String(snippet[markerRange.lowerBound...])
        let payloads = allCaptures(
            in: tail,
            pattern: "data:image/png;base64,([A-Za-z0-9+/=]+)"
        )

        for payload in payloads {
            guard let imageData = Data(base64Encoded: payload, options: [.ignoreUnknownCharacters]) else {
                continue
            }

            let digest = sha256Hex(imageData)
            if let score = parserSpec.scoreImageHashes[digest] {
                return clampScore(score)
            }
        }

        return nil
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

    private func allCaptures(in text: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }

        let range = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, options: [], range: range)
        return matches.compactMap { match -> String? in
            guard match.numberOfRanges > 1,
                  let captureRange = Range(match.range(at: 1), in: text) else {
                return nil
            }
            return String(text[captureRange])
        }
    }

    private func decodeBase64(_ value: String) -> String? {
        guard let data = Data(base64Encoded: value, options: [.ignoreUnknownCharacters]) else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    private func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func clampScore(_ score: Int) -> Int {
        min(max(score, 0), 100)
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
        let sortedBands = parserSpec.riskBands.sorted { left, right in
            left.min > right.min
        }

        for band in sortedBands where score >= band.min {
            return (band.level, band.label)
        }

        return ("medium", "判定")
    }

    private func makeErrorResult(
        asin: String,
        sourceUrl: String,
        message: String,
        errorType: String,
        details: String? = nil
    ) -> [String: Any] {
        var result: [String: Any] = [
            "status": "error",
            "asin": asin,
            "sourceUrl": sourceUrl,
            "fetchedAt": nowIsoString(),
            "message": message,
            "errorType": errorType
        ]

        if let details, details.isEmpty == false {
            result["details"] = details
        }

        return result
    }
}
