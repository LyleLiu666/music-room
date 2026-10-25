import AppKit

// Accept one explicit action only. Never pass URL text to a shell.
final class Launcher: NSObject, NSApplicationDelegate {
    var running = false
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(openURL(_:reply:)), forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }
    @objc func openURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue == "music-room-local://start" else {
            NSApp.terminate(nil)
            return
        }
        guard !running else { return }
        running = true
        guard let script = Bundle.main.object(forInfoDictionaryKey: "MusicRoomLauncherScript") as? String else {
            fail("启动器缺少脚本路径，请重新安装。")
            return
        }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = [script]
        task.terminationHandler = { process in
            DispatchQueue.main.async {
                if process.terminationStatus == 0 { NSApp.terminate(nil) }
                else { self.fail("Music Room 未能启动。请运行项目中的启动脚本查看错误。") }
            }
        }
        do { try task.run() } catch { fail(error.localizedDescription) }
    }
    func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Music Room 启动失败"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}
let app = NSApplication.shared
let launcher = Launcher()
app.delegate = launcher
app.setActivationPolicy(.accessory)
app.run()
