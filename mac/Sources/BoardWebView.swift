import AppKit
import WebKit

/// The board itself: rackio's SPA in a transparent web view, reloading through
/// the outages a machine on a rack inevitably has — server restarted, laptop
/// asleep, Wi-Fi switched networks, web content process killed under pressure.
///
/// Unlike a browser tab, nobody is watching this to hit reload, so every
/// failure path has to end in a retry.
final class BoardWebView: NSObject, WKNavigationDelegate {
    let webView: WKWebView

    private var url: URL?
    private var retryAttempt = 0
    private var retryTimer: Timer?

    /// Backoff for a rack that may be down for a while: 2s, 4s, 8s … capped.
    private static let maxRetryDelay: TimeInterval = 60

    override init() {
        let configuration = WKWebViewConfiguration()
        // The default (persistent) data store keeps localStorage across
        // launches, so the SPA's warm board cache paints the real layout on a
        // cold start instead of the default board.
        configuration.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground") // see mac/README.md
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = .clear
        }
    }

    func load(_ url: URL) {
        self.url = url
        retryAttempt = 0
        cancelRetry()
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func reload() {
        guard let url else { return }
        load(url)
    }

    // MARK: - Retry

    private func scheduleRetry() {
        cancelRetry()
        retryAttempt += 1
        let delay = min(pow(2, Double(retryAttempt)), Self.maxRetryDelay)
        retryTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self, let url = self.url else { return }
            self.webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    private func cancelRetry() {
        retryTimer?.invalidate()
        retryTimer = nil
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retryAttempt = 0
        cancelRetry()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        scheduleRetry()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        scheduleRetry()
    }

    /// The web content process was killed (memory pressure, a GPU reset). The
    /// view is left blank and will not recover on its own.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reload()
    }
}
