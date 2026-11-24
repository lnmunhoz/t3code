// t3-audio-meter: prints the music players' 40-band spectrum as JSON lines on stdout.
//
// Taps only Spotify and Apple Music through a private Core Audio process tap (macOS 14.2+),
// so other app sounds never move the bars. No audio is stored or written anywhere.
// Exit codes: 0 when the set of running players changed (restart to re-tap), 2 when no
// player runs, 1 on any other failure (usually System Audio Recording is not allowed).

import AppKit
import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

let playerBundleIDs = ["com.spotify.client", "com.apple.Music"]
let bandCount = 40

// Constant-peak bandpass from the W3C Audio EQ Cookbook: https://www.w3.org/TR/audio-eq-cookbook/
private struct BandFilter {
    let b0: Double
    let a1: Double
    let a2: Double
    var z1 = 0.0
    var z2 = 0.0

    init(frequency: Double, sampleRate: Double) {
        let omega = 2 * Double.pi * frequency / sampleRate
        let alpha = sin(omega) / (2 * 6.5)
        b0 = alpha / (1 + alpha)
        a1 = -2 * cos(omega) / (1 + alpha)
        a2 = (1 - alpha) / (1 + alpha)
    }

    mutating func consume(_ value: Double) -> Double {
        let output = b0 * value + z1
        z1 = -a1 * output + z2
        z2 = -b0 * value - a2 * output
        return output
    }
}

final class SpectrumMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var filters = [BandFilter]()
    private var peaks = Array(repeating: 0.0, count: bandCount)
    private var sampleRate = 0.0
    private var hasSamples = false

    func consume(_ samples: UnsafeBufferPointer<Float>, sampleRate rate: Double) {
        guard !samples.isEmpty, rate > 0 else { return }
        lock.lock()
        defer { lock.unlock() }
        if rate != sampleRate {
            // Logarithmic spacing from 40 Hz gives bass, mids and treble their own bands.
            let upper = min(16_000, rate * 0.45)
            filters = (0..<bandCount).map {
                BandFilter(frequency: 40 * pow(upper / 40, Double($0) / Double(bandCount - 1)), sampleRate: rate)
            }
            peaks = Array(repeating: 0, count: bandCount)
            sampleRate = rate
        }
        for index in filters.indices {
            var filter = filters[index]
            var sum = 0.0
            for sample in samples {
                let value = filter.consume(Double(sample))
                sum += value * value
            }
            filters[index] = filter
            let rms = sqrt(sum / Double(samples.count))
            // A fixed -60 to -6 dB range shows quiet detail without inventing activity.
            peaks[index] = max(peaks[index], max(0, min(1, (20 * log10(max(rms, 0.000001)) + 60) / 54)))
        }
        hasSamples = true
    }

    func takeReading() -> [Double]? {
        lock.lock()
        defer { lock.unlock() }
        guard hasSamples else { return nil }
        hasSamples = false
        let reading = peaks
        peaks = Array(repeating: 0, count: bandCount)
        return reading
    }
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(code)
}

func check(_ status: OSStatus, _ operation: String) {
    if status != noErr { fail("\(operation) failed (\(status)).") }
}

func runningPlayerPIDs() -> [pid_t] {
    playerBundleIDs.flatMap { id in
        NSRunningApplication.runningApplications(withBundleIdentifier: id)
            .filter { !$0.isTerminated }
            .map(\.processIdentifier)
    }.sorted()
}

func processObject(for pid: pid_t) -> AudioObjectID? {
    var pid = pid
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
                                             mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var object = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address,
                                            UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
    return status == noErr && object != kAudioObjectUnknown ? object : nil
}

func tapUID(_ tap: AudioObjectID) -> CFString {
    var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyUID,
                                             mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var uid: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    check(withUnsafeMutablePointer(to: &uid) { AudioObjectGetPropertyData(tap, &address, 0, nil, &size, $0) },
          "Reading the audio tap identifier")
    return uid
}

func inputFormat(_ device: AudioObjectID) -> AudioStreamBasicDescription {
    var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamFormat,
                                             mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var format = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    check(AudioObjectGetPropertyData(device, &address, 0, nil, &size, &format), "Reading the audio format")
    guard format.mFormatID == kAudioFormatLinearPCM, format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          format.mBitsPerChannel == 32 else { fail("Unsupported audio format.") }
    return format
}

func runMeter() -> Never {
    let pids = runningPlayerPIDs()
    let processes = pids.compactMap(processObject)
    if processes.isEmpty { fail("No music player is running.", code: 2) }

    let description = CATapDescription(stereoMixdownOfProcesses: processes)
    description.name = "T3 Code Music Meter"
    description.isPrivate = true
    var tap = AudioObjectID(kAudioObjectUnknown)
    check(AudioHardwareCreateProcessTap(description, &tap), "Creating the audio tap")

    let aggregate: [String: Any] = [
        kAudioAggregateDeviceNameKey: "T3 Code Music Meter",
        kAudioAggregateDeviceUIDKey: "com.t3tools.music-meter.\(UUID().uuidString)",
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapUID(tap) as String]],
    ]
    var device = AudioObjectID(kAudioObjectUnknown)
    check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "Creating the meter device")

    let format = inputFormat(device)
    let meter = SpectrumMeter()
    var ioProc: AudioDeviceIOProcID?
    let queue = DispatchQueue(label: "com.t3tools.music-meter.samples", qos: .userInteractive)
    check(AudioDeviceCreateIOProcIDWithBlock(&ioProc, device, queue) { _, input, _, _, _ in
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        let channels = buffers.reduce(0) { $0 + Int($1.mNumberChannels) }
        let frames = buffers.map { Int($0.mDataByteSize) / MemoryLayout<Float>.size / max(1, Int($0.mNumberChannels)) }.min() ?? 0
        guard frames > 0, channels > 0 else { return }
        var mono = [Float](repeating: 0, count: frames)
        for buffer in buffers {
            guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
            let count = Int(buffer.mNumberChannels)
            for frame in 0..<frames {
                for channel in 0..<count { mono[frame] += data[frame * count + channel] / Float(channels) }
            }
        }
        mono.withUnsafeBufferPointer { meter.consume($0, sampleRate: format.mSampleRate) }
    }, "Attaching the meter")
    guard let ioProc else { fail("The meter did not start.") }

    // A running tap device costs coreaudiod a third of a core even when the player is paused and
    // the samples are silent. So the device only runs while a player is sending audio out, which
    // Core Audio reports per process without any IO of our own.
    var running = false
    let isRunningOutput = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyIsRunningOutput,
                                                     mScope: kAudioObjectPropertyScopeGlobal,
                                                     mElement: kAudioObjectPropertyElementMain)
    let anyPlayerPlaying = {
        processes.contains { process in
            var address = isRunningOutput
            var value: UInt32 = 0
            var size = UInt32(MemoryLayout<UInt32>.size)
            return AudioObjectGetPropertyData(process, &address, 0, nil, &size, &value) == noErr && value != 0
        }
    }
    let updateRunning = {
        let playing = anyPlayerPlaying()
        if playing == running { return }
        running = playing
        if playing {
            check(AudioDeviceStart(device, ioProc), "Starting the meter")
        } else {
            AudioDeviceStop(device, ioProc)
        }
    }
    for process in processes {
        var address = isRunningOutput
        AudioObjectAddPropertyListenerBlock(process, &address, .main) { _, _ in updateRunning() }
    }
    updateRunning()

    let shutdown = {
        if running { AudioDeviceStop(device, ioProc) }
        AudioDeviceDestroyIOProcID(device, ioProc)
        AudioHardwareDestroyAggregateDevice(device)
        AudioHardwareDestroyProcessTap(tap)
    }
    signal(SIGTERM, SIG_IGN)
    let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    terminate.setEventHandler { shutdown(); exit(0) }
    terminate.resume()

    let readings = DispatchSource.makeTimerSource(queue: .main)
    readings.schedule(deadline: .now(), repeating: .milliseconds(20))
    readings.setEventHandler {
        guard let reading = meter.takeReading(),
              let json = try? JSONSerialization.data(withJSONObject: reading) else { return }
        FileHandle.standardOutput.write(json + Data([0x0A]))
    }
    readings.resume()

    // A player that quits or launches needs a new tap; the desktop app restarts the meter.
    let players = DispatchSource.makeTimerSource(queue: .main)
    players.schedule(deadline: .now() + 2, repeating: .seconds(2))
    players.setEventHandler {
        if runningPlayerPIDs() != pids { shutdown(); exit(0) }
    }
    players.resume()

    // Stop with the desktop app even if it dies without signalling.
    let parent = DispatchSource.makeProcessSource(identifier: getppid(), eventMask: .exit, queue: .main)
    parent.setEventHandler { shutdown(); exit(0) }
    parent.resume()

    RunLoop.main.run()
    exit(0)
}

// macOS asks the "responsible" app for System Audio Recording. Launched from a terminal or a
// dev Electron, that is the terminal, which never shows a prompt. So the meter re-launches
// itself as its own responsible process, and macOS asks for "T3 Code Music Meter" by name.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

func relaunchAsOwnResponsibleProcess() {
    guard ProcessInfo.processInfo.environment["T3_AUDIO_METER_DISCLAIMED"] == nil else { return }
    var attrs: posix_spawnattr_t?
    posix_spawnattr_init(&attrs)
    defer { posix_spawnattr_destroy(&attrs) }
    _ = responsibility_spawnattrs_setdisclaim(&attrs, 1)
    let path = CommandLine.arguments[0]
    var env = ProcessInfo.processInfo.environment
    env["T3_AUDIO_METER_DISCLAIMED"] = "1"
    let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
    let envp: [UnsafeMutablePointer<CChar>?] = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
    var child: pid_t = 0
    guard posix_spawn(&child, path, nil, &attrs, argv, envp) == 0 else { return }
    // Stop the child with this process, and pass its exit code on.
    for sig in [SIGTERM, SIGINT, SIGHUP] { signal(sig) { _ in kill(childPID, SIGTERM); exit(0) } }
    childPID = child
    var status: Int32 = 0
    while waitpid(child, &status, 0) == -1 && errno == EINTR {}
    exit((status & 0x7f) == 0 ? (status >> 8) & 0xff : 1)
}
nonisolated(unsafe) var childPID: pid_t = 0

relaunchAsOwnResponsibleProcess()
// Core Audio checks the Microphone permission before a process tap delivers samples, and that
// check never prompts. `--request-access` (the Settings button) asks in front and opens System
// Settings when access was turned down; the meter itself never prompts from the background.
if CommandLine.arguments.contains("--request-access") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    if status == .denied || status == .restricted {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
        print("denied")
        exit(3)
    }
    let done = DispatchSemaphore(value: 0)
    var granted = status == .authorized
    if !granted {
        AVCaptureDevice.requestAccess(for: .audio) { granted = $0; done.signal() }
        while done.wait(timeout: .now() + 0.05) == .timedOut {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
        }
    }
    print(granted ? "granted" : "denied")
    exit(granted ? 0 : 3)
}
if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
    fail("Microphone access is off for the music meter. Use Settings › Labs › Music bars › Allow.")
}
runMeter()
