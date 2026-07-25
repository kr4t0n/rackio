import AppKit

/// A borderless, transparent window pinned to the desktop layer: it sits on
/// the wallpaper, never joins the window cycle, and follows you across Spaces.
///
/// This is the whole trick. macOS stacks windows by *level*, and Finder draws
/// the wallpaper and its icons at well-known levels below every ordinary
/// window. Ask for one of those levels and the OS treats the window as part of
/// the desktop — no Cmd-Tab entry, no shadow, never in front of real work.
final class WallpaperWindow: NSWindow {
    // Borderless windows refuse key status by default, and interactive mode
    // needs it for hover and clicks inside the web view. Main is never wanted:
    // an accessory app has no menu bar for a main window to own.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    init(screen: NSScreen) {
        // visibleFrame, not frame — keeps the board clear of the menu bar and
        // the Dock, both of which draw above the desktop layer anyway.
        super.init(
            contentRect: screen.visibleFrame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false,
            screen: screen
        )

        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isMovable = false
        isMovableByWindowBackground = false
        isReleasedWhenClosed = false
        animationBehavior = .none
        // Stationary keeps it put when Mission Control shuffles Spaces;
        // ignoresCycle keeps it out of Cmd-` ; fullScreenNone stops it being
        // dragged into a fullscreen Space.
        collectionBehavior = [
            .canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone,
        ]

        contentView = NSView(frame: NSRect(origin: .zero, size: screen.visibleFrame.size))
        contentView?.wantsLayer = true

        applyPreferences()
    }

    /// `.desktopIconWindow` is the layer Finder draws icons on; one above it
    /// floats the board over the icons, and `.desktopWindow` tucks it beneath.
    static func desktopLevel(aboveIcons: Bool) -> NSWindow.Level {
        if aboveIcons {
            return NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        }
        return NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    }

    /// Re-read the two live preferences. Cheap enough to call on every change.
    func applyPreferences() {
        ignoresMouseEvents = !Preferences.interactive
        level = Self.desktopLevel(aboveIcons: Preferences.aboveIcons)
    }
}
