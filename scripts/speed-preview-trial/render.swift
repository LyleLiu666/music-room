import Foundation
import AVFoundation

let args = CommandLine.arguments
if args.count != 4 { fatalError("usage: render input.wav output.wav rate") }
guard let rate = Float(args[3]), rate.isFinite, rate >= 0.5 && rate <= 2 else {
  fputs("rate must be between 0.5 and 2.0\n", stderr)
  exit(1)
}
func render() throws {
let input = try AVAudioFile(forReading: URL(fileURLWithPath: args[1]))
let engine = AVAudioEngine()
let player = AVAudioPlayerNode()
let stretch = AVAudioUnitTimePitch()
stretch.rate = rate
stretch.pitch = 0
stretch.overlap = 8
engine.attach(player)
engine.attach(stretch)
engine.connect(player, to: stretch, format: input.processingFormat)
engine.connect(stretch, to: engine.mainMixerNode, format: input.processingFormat)
try engine.enableManualRenderingMode(.offline, format: input.processingFormat, maximumFrameCount: 4096)
let output = try AVAudioFile(forWriting: URL(fileURLWithPath: args[2]), settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: input.processingFormat.sampleRate, AVNumberOfChannelsKey: input.processingFormat.channelCount, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
let target = AVAudioFramePosition((Double(input.length) / Double(rate)).rounded())
player.scheduleFile(input, at: nil)
try engine.start()
player.play()
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: engine.manualRenderingMaximumFrameCount)!
var frames: AVAudioFramePosition = 0
var stalls = 0
while frames < target {
  let count = AVAudioFrameCount(min(AVAudioFramePosition(buffer.frameCapacity), target - frames))
  let state = try engine.renderOffline(count, to: buffer)
  switch state {
  case .success:
    try output.write(from: buffer)
    frames += AVAudioFramePosition(buffer.frameLength)
    stalls = 0
  case .insufficientDataFromInputNode, .cannotDoInCurrentContext:
    stalls += 1
    if stalls > 10000 { fatalError("renderer stalled") }
  case .error: fatalError("render failed")
  @unknown default: fatalError("unknown render state")
  }
}
player.stop()
engine.stop()
print("frames=\(frames) sampleRate=\(input.processingFormat.sampleRate) latency=\(stretch.auAudioUnit.latency)")

}
try render()
