import AppKit

// Accessory activation policy: no Dock icon and no app menu bar. The board is
// wallpaper, not a window you switch to — everything hangs off the status item.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
