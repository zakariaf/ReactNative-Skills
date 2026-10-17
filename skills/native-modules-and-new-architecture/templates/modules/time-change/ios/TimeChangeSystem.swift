// modules/time-change/ios/TimeChangeSystem.swift
// What iOS says about time changes, in plain Foundation and UIKit (no Expo types), so it type-checks
// on its own: xcrun swiftc -typecheck -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)"
//   -target arm64-apple-ios16.4-simulator TimeChangeSystem.swift
import Foundation
import UIKit

/// Why the device's time moved. The raw values are the strings the Android side and the port use.
enum TimeChangeReason: String {
  case timeZone = "time-zone"
  case clockSet = "clock-set"
  case dayChange = "day-change"
}

enum TimeChangeSystem {
  /// The system notifications and the reason each one means. The significant-time-change
  /// notification also follows a time zone or clock change, so listeners re-read and stay idempotent.
  static let notifications: [(name: Notification.Name, reason: TimeChangeReason)] = [
    (.NSSystemTimeZoneDidChange, .timeZone),
    (.NSSystemClockDidChange, .clockSet),
    (UIApplication.significantTimeChangeNotification, .dayChange),
  ]

  /// The IANA time zone id now ("Europe/Berlin"). Foundation caches the system zone per process,
  /// so the cache is reset before every read.
  static func currentTimeZoneId() -> String {
    NSTimeZone.resetSystemTimeZone()
    return TimeZone.current.identifier
  }
}

/// Holds the notification observers between start() and stop(); stop() releases every one.
final class TimeChangeObserver {
  private var tokens: [NSObjectProtocol] = []

  func start(_ onChange: @escaping (TimeChangeReason) -> Void) {
    stop()
    tokens = TimeChangeSystem.notifications.map { entry in
      NotificationCenter.default.addObserver(forName: entry.name, object: nil, queue: .main) { _ in
        onChange(entry.reason)
      }
    }
  }

  func stop() {
    for token in tokens {
      NotificationCenter.default.removeObserver(token)
    }
    tokens = []
  }
}
