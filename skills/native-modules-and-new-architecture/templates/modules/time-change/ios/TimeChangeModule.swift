// modules/time-change/ios/TimeChangeModule.swift
// The JavaScript face of the module. Thin on purpose: what the system says lives in
// TimeChangeSystem.swift, which compiles without Expo. The adapter's TimeChangeBinding type in
// src/services/time-change/native-time-change-adapter.ts names every member below; edit both together.
import ExpoModulesCore

public class TimeChangeModule: Module {
  private let observer = TimeChangeObserver()

  public func definition() -> ModuleDefinition {
    Name("TimeChange")

    Events("onTimeChange")

    // A cheap read: a synchronous function runs on the JavaScript thread.
    Function("getTimeZoneId") { () -> String in
      TimeChangeSystem.currentTimeZoneId()
    }

    // Observe only while JavaScript listens: the first listener starts, the last one stops.
    OnStartObserving("onTimeChange") {
      self.observer.start { [weak self] reason in
        self?.sendEvent("onTimeChange", [
          "reason": reason.rawValue,
          "timeZoneId": TimeChangeSystem.currentTimeZoneId(),
        ])
      }
    }

    OnStopObserving("onTimeChange") {
      self.observer.stop()
    }

    OnDestroy {
      self.observer.stop()
    }
  }
}
