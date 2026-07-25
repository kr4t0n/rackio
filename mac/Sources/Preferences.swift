import Foundation

/// Everything the app remembers, in UserDefaults. There is no config file and
/// no settings window — this is a viewer for one board, driven by the status
/// menu. Board layout and card config live on the rackio server, not here.
enum Preferences {
    private static let defaults = UserDefaults.standard

    private enum Key {
        static let boardURL = "boardURL"
        static let interactive = "interactive"
        static let aboveIcons = "aboveIcons"
    }

    static let fallbackURL = "http://localhost:3000/"

    /// Where rackio is served — a LAN host, a tailnet IP, or localhost.
    static var boardURL: String {
        get { defaults.string(forKey: Key.boardURL) ?? fallbackURL }
        set { defaults.set(newValue, forKey: Key.boardURL) }
    }

    /// Off by default: wallpaper doesn't eat clicks. When off the window sets
    /// `ignoresMouseEvents`, so clicks and drags pass straight through to the
    /// desktop and to whatever Finder icons sit underneath.
    static var interactive: Bool {
        get { defaults.bool(forKey: Key.interactive) }
        set { defaults.set(newValue, forKey: Key.interactive) }
    }

    /// Whether the board floats above Finder's desktop icons or tucks under
    /// them. Defaults to above — otherwise icons cover the cards.
    static var aboveIcons: Bool {
        get { defaults.object(forKey: Key.aboveIcons) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Key.aboveIcons) }
    }

    /// The SPA only renders its transparent, chrome-less shell when asked, so
    /// `?shell=wallpaper` is appended here rather than trusted to the user's
    /// typing. A scheme is assumed if omitted (`rack.local:3000`).
    static func resolvedURL() -> URL? {
        let raw = boardURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        let withScheme = raw.contains("://") ? raw : "http://\(raw)"
        guard var components = URLComponents(string: withScheme) else { return nil }

        var items = components.queryItems ?? []
        if !items.contains(where: { $0.name == "shell" }) {
            items.append(URLQueryItem(name: "shell", value: "wallpaper"))
        }
        components.queryItems = items
        return components.url
    }
}
