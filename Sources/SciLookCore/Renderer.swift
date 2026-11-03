import Foundation
import JavaScriptCore

/// Makes the HTML preview for a file by running the bundled preview code in JavaScriptCore. The
/// code asks for bytes as it needs them, and gets them straight from the file, so a 10 GB NWB
/// recording costs a few hundred kilobytes of reads.
public final class Renderer {
    public enum Failure: Error, CustomStringConvertible {
        case missingScript, scriptFailed(String), notFinished

        public var description: String {
            switch self {
            case .missingScript: "The preview code is missing from the extension."
            case .scriptFailed(let message): message
            case .notFinished: "The preview didn't finish."
            }
        }
    }

    /// Reads up to this many bytes in one request; the preview code never asks for more.
    static let maxRead = 256 * 1024 * 1024
    private let script: String

    /// `script` is the bundled preview code; by default, scilook.js in the extension's Resources.
    public init(script scriptURL: URL? = nil) throws {
        guard let url = scriptURL ?? Bundle.main.url(forResource: "scilook", withExtension: "js"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { throw Failure.missingScript }
        script = text
    }

    /// The bytes read so far by the last `render`, for tests that check reads stay small.
    public private(set) var bytesRead = 0

    public func render(fileAt url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let size = Int(try handle.seekToEnd())
        bytesRead = 0

        guard let context = JSContext() else { throw Failure.scriptFailed("JavaScriptCore didn't start.") }
        var thrown: String?
        context.exceptionHandler = { _, value in thrown = value?.toString() }
        context.evaluateScript(script)
        if let thrown { throw Failure.scriptFailed(thrown) }

        // read(offset, length) hands back a Uint8Array of exactly those bytes.
        let read: @convention(block) (Double, Double) -> JSValue? = { [weak self] offset, length in
            guard let current = JSContext.current() else { return nil }
            let start = Int(offset)
            let count = Int(length)
            guard start >= 0, count >= 0, count <= Renderer.maxRead, start + count <= size else {
                current.exception = JSValue(newErrorFromMessage: "Read past the end of the file.", in: current)
                return nil
            }
            do {
                try handle.seek(toOffset: UInt64(start))
                let data = try handle.read(upToCount: count) ?? Data()
                self?.bytesRead += data.count
                return Renderer.uint8Array(data, in: current)
            } catch {
                current.exception = JSValue(newErrorFromMessage: "The file couldn't be read.", in: current)
                return nil
            }
        }
        let source = JSValue(newObjectIn: context)!
        source.setValue(url.lastPathComponent, forProperty: "name")
        source.setValue(size, forProperty: "size")
        source.setValue(read, forProperty: "read")

        var html: String?
        var failure: String?
        let done: @convention(block) (JSValue) -> Void = { html = $0.toString() }
        let failed: @convention(block) (JSValue) -> Void = { failure = $0.toString() }
        let promise = context.objectForKeyedSubscript("SciLook").invokeMethod("preview", withArguments: [source])
        // The file reads answer at once, so the whole chain settles before this call returns.
        promise?.invokeMethod("then", withArguments: [JSValue(object: done, in: context)!, JSValue(object: failed, in: context)!])
        if let thrown { throw Failure.scriptFailed(thrown) }
        if let failure { throw Failure.scriptFailed(failure) }
        guard let html else { throw Failure.notFinished }
        return html
    }

    static func uint8Array(_ data: Data, in context: JSContext) -> JSValue? {
        var exception: JSValueRef?
        guard let array = JSObjectMakeTypedArray(context.jsGlobalContextRef, kJSTypedArrayTypeUint8Array, data.count, &exception), exception == nil else { return nil }
        if !data.isEmpty, let target = JSObjectGetTypedArrayBytesPtr(context.jsGlobalContextRef, array, &exception) {
            data.withUnsafeBytes { target.copyMemory(from: $0.baseAddress!, byteCount: data.count) }
        }
        return JSValue(jsValueRef: array, in: context)
    }
}
