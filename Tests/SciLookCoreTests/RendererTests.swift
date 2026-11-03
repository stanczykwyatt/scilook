import Foundation
import Testing
@testable import SciLookCore

/// The preview, made in Swift through JavaScriptCore exactly as the extension makes it.
struct RendererTests {
    /// The bundled preview code, from the source tree, as the build script copies it into the extension.
    static let script = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../Sources/SciLookCore/Resources/scilook.js").standardizedFileURL

    func fixture(_ name: String) -> URL {
        Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures")!
    }

    @Test(arguments: ["earliest.nwb", "latest.nwb"])
    func nwbFilesShowFactsTreeAndPlot(name: String) throws {
        let html = try Renderer(script: Self.script).render(fileAt: fixture(name))
        #expect(html.contains("NWB (HDF5)"))
        #expect(html.contains("<dt>Session</dt><dd>Made-up session for tests</dd>"))
        #expect(html.contains("<h2>/acquisition/ElectricalSeries/data</h2>"))
        #expect(html.contains("<svg viewBox=\"0 0 640 220\""))
        #expect(html.contains("trace_39"))
    }

    @Test func nwbReadsAreLazy() throws {
        let renderer = try Renderer(script: Self.script)
        let url = fixture("earliest.nwb")
        _ = try renderer.render(fileAt: url)
        let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as! Int
        #expect(renderer.bytesRead > 0)
        #expect(renderer.bytesRead < size * 2)
    }

    @Test func matlabNumPyAndNpz() throws {
        let renderer = try Renderer(script: Self.script)
        #expect(try renderer.render(fileAt: fixture("session-compressed.mat")).contains("MATLAB 5.0 MAT-file"))
        #expect(try renderer.render(fileAt: fixture("v73.mat")).contains("MATLAB v7.3 (HDF5)"))
        let npy = try renderer.render(fileAt: fixture("grid.npy"))
        #expect(npy.contains("2 × 3 × 4 float64"))
        #expect(npy.contains("data:image/png;base64,"))
        #expect(try renderer.render(fileAt: fixture("bundle-compressed.npz")).contains(">labels</span></td><td>3 uint8"))
    }

    @Test func picklesAreRefused() throws {
        #expect(try Renderer(script: Self.script).render(fileAt: fixture("objects.npy")).contains("never loads those"))
    }

    @Test func unknownAndEmptyFilesAreExplained() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let text = dir.appendingPathComponent("notes.h5")
        try Data("not really hdf5".utf8).write(to: text)
        #expect(try Renderer(script: Self.script).render(fileAt: text).contains("doesn&#39;t recognize"))
        let empty = dir.appendingPathComponent("empty.npy")
        try Data().write(to: empty)
        #expect(try Renderer(script: Self.script).render(fileAt: empty).contains("<h1>empty.npy</h1>"))
    }
}
