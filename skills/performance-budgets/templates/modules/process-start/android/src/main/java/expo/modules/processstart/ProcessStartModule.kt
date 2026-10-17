// modules/process-start/android/src/main/java/expo/modules/processstart/ProcessStartModule.kt
package expo.modules.processstart

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProcessStartModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ProcessStart")
    // Wall-clock start of this process in epoch milliseconds.
    Function("getProcessStartEpochMs") {
      ProcessStartInfo.startEpochMs()
    }
    // True when the system started the process before the user's launch (Android 15+ knows).
    Function("wasPrewarmed") {
      ProcessStartInfo.wasStartedInBackground(appContext.reactContext)
    }
    // The report header's device model.
    Function("getDeviceModel") {
      ProcessStartInfo.deviceModel()
    }
  }
}
