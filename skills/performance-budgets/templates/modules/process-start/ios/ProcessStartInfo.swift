// modules/process-start/ios/ProcessStartInfo.swift
// What the cold-start measurement reads from the system. Plain Darwin/Foundation, no Expo types, so
// it type-checks on its own (swiftc -typecheck with the iOS simulator SDK).
import Darwin
import Foundation

enum ProcessStartInfo {
  /// Wall-clock start time of this process in epoch milliseconds (sysctl KERN_PROC_PID p_starttime), or -1.
  static func startEpochMs() -> Double {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return -1 }
    let start = info.kp_proc.p_starttime
    return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
  }

  /// iOS 15+ may create the process ahead of a launch, load its libraries and suspend it before
  /// main() calls UIApplicationMain ("prewarming"); such a process carries ActivePrewarm=1, and its
  /// p_starttime is minutes or hours before the user's tap.
  static func wasPrewarmed() -> Bool {
    ProcessInfo.processInfo.environment["ActivePrewarm"] == "1"
  }

  /// The hardware identifier ("iPhone17,1"); a simulator reports the device it simulates.
  static func deviceModel() -> String {
    if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return "\(simulated) (simulator)"
    }
    var size = 0
    guard sysctlbyname("hw.machine", nil, &size, nil, 0) == 0, size > 0 else { return "unknown" }
    var machine = [CChar](repeating: 0, count: size)
    guard sysctlbyname("hw.machine", &machine, &size, nil, 0) == 0 else { return "unknown" }
    return String(cString: machine)
  }
}
