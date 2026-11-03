import AppKit
import SwiftUI

/// The app exists to carry the Quick Look extension. Opening it once registers the extension;
/// its window says how to use it.
@main
struct SciLookApp: App {
    var body: some Scene {
        Window("SciLook", id: "main") {
            WelcomeView()
        }
        .windowResizability(.contentSize)
    }
}

struct WelcomeView: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
            Text("SciLook is ready")
                .font(.title2.weight(.semibold))
            Text("Select an .nwb, .h5, .hdf5, .mat, .npy or .npz file in Finder and press Space to see what's inside.")
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text("If nothing shows, turn SciLook on in System Settings › General › Login Items & Extensions › Quick Look. You can quit this app; the preview keeps working.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Open Extension Settings") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.ExtensionsPreferences") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
        .padding(28)
        .frame(width: 420)
    }
}
