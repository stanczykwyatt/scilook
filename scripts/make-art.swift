// Draws the icon (Resources/AppIcon.icns and docs/icon.png), the README demo (docs/demo.gif) and
// the link preview image (docs/social.png). The Finder window is drawn here; the previews inside it
// are SciLook's real output for made-up files (scripts/art/preview-*.png, rendered off screen).
//
//   swift scripts/make-art.swift
import AppKit
import ImageIO
import UniformTypeIdentifiers

let ink = NSColor(srgbRed: 0.05, green: 0.06, blue: 0.07, alpha: 1)
let ice = NSColor(srgbRed: 0.62, green: 0.82, blue: 1.0, alpha: 1)
let slate = NSColor(srgbRed: 0.13, green: 0.17, blue: 0.27, alpha: 1)

func bitmap(_ width: Int, _ height: Int, draw: () -> Void) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

// MARK: Icon

/// A sheet of paper with a small plot on it, on a slate tile, with an ice-blue lens: a look at data.
func icon(pixels: Int) -> NSBitmapImageRep {
    bitmap(pixels, pixels) {
        let scale = NSAffineTransform()
        scale.scale(by: CGFloat(pixels) / 1024)
        scale.concat()
        let tile = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
        NSGraphicsContext.saveGraphicsState()
        let tileShadow = NSShadow()
        tileShadow.shadowColor = .black.withAlphaComponent(0.3)
        tileShadow.shadowBlurRadius = 24
        tileShadow.shadowOffset = NSSize(width: 0, height: -12)
        tileShadow.set()
        slate.setFill()
        tile.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGradient(colors: [
            NSColor(srgbRed: 0.80, green: 0.87, blue: 0.96, alpha: 1),
            NSColor(srgbRed: 0.45, green: 0.57, blue: 0.75, alpha: 1),
            slate,
        ])!.draw(in: tile, angle: -90)

        let sheet = NSBezierPath(roundedRect: NSRect(x: 230, y: 210, width: 470, height: 600), xRadius: 40, yRadius: 40)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
        shadow.shadowBlurRadius = 22
        shadow.shadowOffset = NSSize(width: 0, height: -10)
        shadow.set()
        NSColor.white.withAlphaComponent(0.96).setFill()
        sheet.fill()
        NSGraphicsContext.restoreGraphicsState()
        // Rows of a table, then a wave.
        slate.withAlphaComponent(0.25).setFill()
        for (i, w) in [CGFloat(300), 220, 260].enumerated() {
            NSBezierPath(roundedRect: NSRect(x: 290, y: 330 - CGFloat(i) * 50, width: w, height: 24), xRadius: 12, yRadius: 12).fill()
        }
        let wave = NSBezierPath()
        for i in 0...100 {
            let x = 290 + CGFloat(i) * 3.5
            let y = 600 + sin(CGFloat(i) / 100 * 4 * .pi) * 90 * (0.4 + CGFloat(i) / 160)
            i == 0 ? wave.move(to: NSPoint(x: x, y: y)) : wave.line(to: NSPoint(x: x, y: y))
        }
        NSColor(srgbRed: 0.23, green: 0.44, blue: 0.71, alpha: 1).setStroke()
        wave.lineWidth = 26
        wave.lineCapStyle = .round
        wave.lineJoinStyle = .round
        wave.stroke()

        NSGraphicsContext.saveGraphicsState()
        let glow = NSShadow()
        glow.shadowColor = ice.withAlphaComponent(0.8)
        glow.shadowBlurRadius = 30
        glow.set()
        ice.setStroke()
        let lens = NSBezierPath(ovalIn: NSRect(x: 520, y: 200, width: 240, height: 240))
        lens.lineWidth = 44
        lens.stroke()
        let handle = NSBezierPath()
        handle.move(to: NSPoint(x: 728, y: 232))
        handle.line(to: NSPoint(x: 830, y: 130))
        handle.lineWidth = 60
        handle.lineCapStyle = .round
        handle.stroke()
        NSGraphicsContext.restoreGraphicsState()
        ice.withAlphaComponent(0.18).setFill()
        NSBezierPath(ovalIn: NSRect(x: 542, y: 222, width: 196, height: 196)).fill()
    }
}

let iconset = FileManager.default.temporaryDirectory.appendingPathComponent("SciLook.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(points)x\(points).png" : "icon_\(points)x\(points)@2x.png"
        try icon(pixels: points * scale).representation(using: .png, properties: [:])!.write(to: iconset.appendingPathComponent(name))
    }
}
try icon(pixels: 256).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "docs/icon.png"))
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["--convert", "icns", iconset.path, "--output", "Resources/AppIcon.icns"]
try iconutil.run()
iconutil.waitUntilExit()

// MARK: Demo and social image

func wallpaper(_ rect: NSRect) {
    NSGradient(starting: NSColor(srgbRed: 0.08, green: 0.09, blue: 0.13, alpha: 1), ending: ink)!.draw(in: rect, angle: -90)
    for (x, y, r, color) in [
        (0.18, 0.75, 0.42, NSColor(srgbRed: 0.84, green: 0.89, blue: 0.95, alpha: 0.45)),
        (0.85, 0.72, 0.38, NSColor(srgbRed: 0.59, green: 0.68, blue: 0.81, alpha: 0.40)),
        (0.70, 0.12, 0.46, NSColor(srgbRed: 0.75, green: 0.81, blue: 0.89, alpha: 0.32)),
    ] as [(CGFloat, CGFloat, CGFloat, NSColor)] {
        let center = NSPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
        NSGradient(starting: color, ending: color.withAlphaComponent(0))!.draw(fromCenter: center, radius: 0, toCenter: center, radius: rect.width * r, options: [])
    }
}

@discardableResult
func text(_ string: String, at point: NSPoint, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .white, centered: Bool = false, mono: Bool = false) -> CGFloat {
    let font = mono ? NSFont.monospacedSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let width = (string as NSString).size(withAttributes: attributes).width
    (string as NSString).draw(at: NSPoint(x: centered ? point.x - width / 2 : point.x, y: point.y), withAttributes: attributes)
    return width
}

let W: CGFloat = 720, H: CGFloat = 450
let previews = ["recording.h5": NSImage(contentsOfFile: "scripts/art/preview-recording.png")!, "behavior.mat": NSImage(contentsOfFile: "scripts/art/preview-behavior.png")!]
let files = ["behavior.mat", "frames.npy", "recording.h5", "session-0412.nwb"]

func scene(selected: String, open: Bool) -> NSBitmapImageRep {
    bitmap(Int(W), Int(H)) {
        wallpaper(NSRect(x: 0, y: 0, width: W, height: H))
        // A Finder list on the left.
        let finder = NSRect(x: 24, y: 70, width: 300, height: 310)
        NSColor(srgbRed: 0.12, green: 0.13, blue: 0.15, alpha: 0.97).setFill()
        NSBezierPath(roundedRect: finder, xRadius: 12, yRadius: 12).fill()
        for (i, color) in [NSColor.systemRed, .systemYellow, .systemGreen].enumerated() {
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: finder.minX + 14 + CGFloat(i) * 18, y: finder.maxY - 22, width: 11, height: 11)).fill()
        }
        text("Data", at: NSPoint(x: finder.midX, y: finder.maxY - 24), size: 12.5, weight: .semibold, color: .white.withAlphaComponent(0.8), centered: true)
        for (i, name) in files.enumerated() {
            let y = finder.maxY - 62 - CGFloat(i) * 30
            if name == selected {
                NSColor(srgbRed: 0.18, green: 0.42, blue: 0.85, alpha: 1).setFill()
                NSBezierPath(roundedRect: NSRect(x: finder.minX + 8, y: y - 7, width: finder.width - 16, height: 26), xRadius: 6, yRadius: 6).fill()
            }
            text("▤  \(name)", at: NSPoint(x: finder.minX + 18, y: y), size: 13, color: .white.withAlphaComponent(0.9))
        }
        if !open {
            text("Press Space", at: NSPoint(x: finder.midX, y: finder.minY + 18), size: 12, color: ice, centered: true)
            return
        }
        // The Quick Look panel, holding SciLook's real preview.
        let panel = NSRect(x: 250, y: 24, width: 446, height: 400)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = .black.withAlphaComponent(0.6)
        shadow.shadowBlurRadius = 28
        shadow.shadowOffset = NSSize(width: 0, height: -10)
        shadow.set()
        NSColor(srgbRed: 0.125, green: 0.125, blue: 0.125, alpha: 1).setFill()
        NSBezierPath(roundedRect: panel, xRadius: 12, yRadius: 12).fill()
        NSGraphicsContext.restoreGraphicsState()
        text(selected, at: NSPoint(x: panel.midX, y: panel.maxY - 22), size: 12.5, weight: .semibold, color: .white.withAlphaComponent(0.85), centered: true)
        if let image = previews[selected] {
            let content = NSRect(x: panel.minX + 6, y: panel.minY + 6, width: panel.width - 12, height: panel.height - 36)
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: content, xRadius: 8, yRadius: 8).addClip()
            // Show the top of the page, scaled to the panel's width.
            let scale = content.width / image.size.width
            let h = image.size.height * scale
            image.draw(in: NSRect(x: content.minX, y: content.maxY - h, width: content.width, height: h))
            NSGraphicsContext.restoreGraphicsState()
        }
    }
}

let frames: [(NSBitmapImageRep, Double)] = [
    (scene(selected: "recording.h5", open: false), 1.2),
    (scene(selected: "recording.h5", open: true), 3.0),
    (scene(selected: "behavior.mat", open: false), 0.8),
    (scene(selected: "behavior.mat", open: true), 3.0),
]
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: "docs/demo.gif") as CFURL, UTType.gif.identifier as CFString, frames.count, nil)!
CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
for (rep, hold) in frames {
    CGImageDestinationAddImage(destination, rep.cgImage!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: hold]] as CFDictionary)
}
guard CGImageDestinationFinalize(destination) else { fatalError("Couldn't write the GIF") }

let social = bitmap(1280, 640) {
    wallpaper(NSRect(x: 0, y: 0, width: 1280, height: 640))
    NSImage(contentsOfFile: "docs/icon.png")!.draw(in: NSRect(x: 96, y: 380, width: 140, height: 140))
    text("SciLook", at: NSPoint(x: 96, y: 270), size: 80, weight: .semibold)
    text("Quick Look for scientific data on your Mac.", at: NSPoint(x: 100, y: 214), size: 30, color: .white.withAlphaComponent(0.85))
    text("Press Space on NWB, HDF5, MATLAB or NumPy files.", at: NSPoint(x: 100, y: 164), size: 22, color: ice)
    text(".nwb · .h5 · .mat · .npy · .npz · free, open source, read-only", at: NSPoint(x: 100, y: 100), size: 17, color: .white.withAlphaComponent(0.5), mono: true)
}
try social.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "docs/social.png"))
Swift.print("Wrote the icon, docs/demo.gif and docs/social.png")
