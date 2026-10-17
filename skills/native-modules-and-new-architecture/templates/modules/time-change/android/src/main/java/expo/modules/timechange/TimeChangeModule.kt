// modules/time-change/android/src/main/java/expo/modules/timechange/TimeChangeModule.kt
// The JavaScript face of the module. Thin on purpose: what Android says lives in TimeChangeSystem.kt
// and TimeChangeReceiver.kt. The adapter's TimeChangeBinding type names every member below.
package expo.modules.timechange

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TimeChangeModule : Module() {
  private var receiver: TimeChangeReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("TimeChange")

    Events("onTimeChange")

    // A cheap read: a synchronous function runs on the JavaScript thread.
    Function("getTimeZoneId") {
      TimeChangeSystem.currentTimeZoneId()
    }

    // Android only: iOS has no public "set time automatically" setting (the binding marks it optional).
    // A lost React context rejects with the code ERR_REACT_CONTEXT_LOST, which the adapter maps.
    AsyncFunction("isAutomaticTimeEnabledAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimeChangeSystem.isAutomaticTimeEnabled(context.contentResolver)
    }

    // Observe only while JavaScript listens: the first listener starts, the last one stops.
    OnStartObserving("onTimeChange") {
      val context = appContext.reactContext ?: return@OnStartObserving
      stopObserving()
      receiver = TimeChangeReceiver.register(context) { reason ->
        sendEvent(
          "onTimeChange",
          mapOf("reason" to reason, "timeZoneId" to TimeChangeSystem.currentTimeZoneId()),
        )
      }
    }

    OnStopObserving("onTimeChange") {
      stopObserving()
    }

    OnDestroy {
      stopObserving()
    }
  }

  private fun stopObserving() {
    receiver?.unregister()
    receiver = null
  }
}
