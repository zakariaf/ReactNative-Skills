// modules/process-start/ios/ProcessStartModule.swift
import ExpoModulesCore

public class ProcessStartModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ProcessStart")
    // Wall-clock start time of this process in epoch milliseconds, or -1.
    Function("getProcessStartEpochMs") { () -> Double in
      ProcessStartInfo.startEpochMs()
    }
    // True when the system prewarmed the process before the user's launch.
    Function("wasPrewarmed") { () -> Bool in
      ProcessStartInfo.wasPrewarmed()
    }
    // The report header's device model.
    Function("getDeviceModel") { () -> String in
      ProcessStartInfo.deviceModel()
    }
  }
}
