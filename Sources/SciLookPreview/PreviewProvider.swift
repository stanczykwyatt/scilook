import Foundation
import QuickLookUI
import SciLookCore
import UniformTypeIdentifiers

/// The Quick Look extension: press Space on an NWB, HDF5, MATLAB or NumPy file and this returns
/// a page with the file's structure and a plot. It only reads the file it's given.
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let html = try Renderer().render(fileAt: request.fileURL)
        return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 820, height: 680)) { reply in
            reply.stringEncoding = .utf8
            reply.title = request.fileURL.lastPathComponent
            return Data(html.utf8)
        }
    }
}
