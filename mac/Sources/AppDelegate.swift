import AppKit

/// Owns one wallpaper window per screen and the status menu that drives them.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windows: [WallpaperWindow] = []
    private var boards: [BoardWebView] = []
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildStatusItem()
        rebuildWindows()

        // Displays came or went, or resolution changed: the old frames are
        // meaningless, so start over.
        // Observers live as long as the process; the tokens are deliberately
        // discarded rather than stored for a teardown that never happens.
        _ = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.rebuildWindows()
        }

        // After sleep the board is showing data from before the nap, and any
        // in-flight fetch died with the network interface.
        _ = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.reloadAll()
        }
    }

    // MARK: - Windows

    private func rebuildWindows() {
        windows.forEach { $0.orderOut(nil) }
        windows.removeAll()
        boards.removeAll()

        guard let url = Preferences.resolvedURL() else {
            presentURLPrompt(message: "That board URL can't be parsed.")
            return
        }

        for screen in NSScreen.screens {
            let window = WallpaperWindow(screen: screen)
            let board = BoardWebView()

            board.webView.frame = window.contentView?.bounds ?? .zero
            window.contentView?.addSubview(board.webView)
            // orderFront alone is unreliable for an accessory app that is
            // never active; Regardless is the documented way in.
            window.orderFrontRegardless()

            board.load(url)
            windows.append(window)
            boards.append(board)
        }
    }

    private func reloadAll() {
        guard let url = Preferences.resolvedURL() else { return }
        boards.forEach { $0.load(url) }
    }

    private func applyWindowPreferences() {
        windows.forEach { $0.applyPreferences() }
    }

    // MARK: - Status menu

    private func buildStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(
            systemSymbolName: "rectangle.3.group",
            accessibilityDescription: "Rackio Wallpaper"
        )
        item.button?.toolTip = "Rackio Wallpaper"
        item.menu = buildMenu()
        statusItem = item
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false

        let host = NSMenuItem(title: Preferences.boardURL, action: nil, keyEquivalent: "")
        host.isEnabled = false
        menu.addItem(host)
        menu.addItem(.separator())

        menu.addItem(makeItem("Reload Board", #selector(reloadBoard), key: "r"))

        let interactive = makeItem("Interactive", #selector(toggleInteractive), key: "")
        interactive.state = Preferences.interactive ? .on : .off
        interactive.toolTip = "Off: clicks pass through to the desktop."
        menu.addItem(interactive)

        let aboveIcons = makeItem("Above Desktop Icons", #selector(toggleAboveIcons), key: "")
        aboveIcons.state = Preferences.aboveIcons ? .on : .off
        menu.addItem(aboveIcons)

        menu.addItem(.separator())
        menu.addItem(makeItem("Board URL…", #selector(editBoardURL), key: ""))
        menu.addItem(makeItem("Open in Browser", #selector(openInBrowser), key: ""))
        menu.addItem(.separator())
        menu.addItem(makeItem("Quit", #selector(quit), key: "q"))
        return menu
    }

    private func makeItem(_ title: String, _ action: Selector, key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        item.isEnabled = true
        return item
    }

    private func refreshMenu() {
        statusItem?.menu = buildMenu()
    }

    // MARK: - Actions

    @objc private func reloadBoard() {
        reloadAll()
    }

    @objc private func toggleInteractive() {
        Preferences.interactive.toggle()
        applyWindowPreferences()
        refreshMenu()
    }

    @objc private func toggleAboveIcons() {
        Preferences.aboveIcons.toggle()
        applyWindowPreferences()
        refreshMenu()
    }

    @objc private func editBoardURL() {
        presentURLPrompt(message: nil)
    }

    @objc private func openInBrowser() {
        // The plain board, not the wallpaper shell — this is the escape hatch
        // for editing the layout, which the viewer deliberately can't do.
        let raw = Preferences.boardURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let withScheme = raw.contains("://") ? raw : "http://\(raw)"
        guard let url = URL(string: withScheme) else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func presentURLPrompt(message: String?) {
        // An accessory app is never active, so a modal would open behind
        // whatever the user is looking at.
        NSApp.activate(ignoringOtherApps: true)

        let alert = NSAlert()
        alert.messageText = message ?? "Board URL"
        alert.informativeText = "Where rackio is served — ?shell=wallpaper is added for you."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = Preferences.boardURL
        field.placeholderString = Preferences.fallbackURL
        alert.accessoryView = field
        alert.window.initialFirstResponder = field

        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Preferences.boardURL = field.stringValue
        refreshMenu()
        rebuildWindows()
    }
}
