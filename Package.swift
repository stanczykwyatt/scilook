// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SciLook",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "SciLook", targets: ["SciLook"]),
        .executable(name: "SciLookPreview", targets: ["SciLookPreview"]),
    ],
    targets: [
        // Runs the bundled preview code (Resources/scilook.js) and gives it the file's bytes.
        .target(name: "SciLookCore", exclude: ["Resources"]),
        // The Quick Look extension. Extensions start in NSExtensionMain, not main.
        .executableTarget(
            name: "SciLookPreview",
            dependencies: ["SciLookCore"],
            linkerSettings: [.unsafeFlags(["-Xlinker", "-e", "-Xlinker", "_NSExtensionMain"]), .linkedFramework("QuickLookUI")]
        ),
        // The app that carries the extension: one small window that says how to use it.
        .executableTarget(name: "SciLook"),
        .testTarget(name: "SciLookCoreTests", dependencies: ["SciLookCore"], resources: [.copy("Fixtures")]),
    ]
)
