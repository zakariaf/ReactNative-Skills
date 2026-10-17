// modules/process-start/android/src/main/java/expo/modules/processstart/ProcessStartInfo.kt
// What the cold-start measurement reads from the system. Only android.* types, no Expo types, so it
// compiles on its own against the platform's android.jar.
package expo.modules.processstart

import android.app.ActivityManager
import android.app.ApplicationStartInfo
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.SystemClock

internal object ProcessStartInfo {
  /** Start reasons that mean the user (or a deep link) opened an activity, not a background start. */
  private val LAUNCH_REASONS = setOf(
    ApplicationStartInfo.START_REASON_LAUNCHER,
    ApplicationStartInfo.START_REASON_LAUNCHER_RECENTS,
    ApplicationStartInfo.START_REASON_START_ACTIVITY,
  )

  /**
   * Wall-clock start of this process in epoch milliseconds. Android reports the start on the
   * elapsed-realtime clock; the current offset between the two clocks converts it. API 33+ gives the
   * moment the start was requested (before the zygote fork), the closer match to a tap.
   */
  fun startEpochMs(): Double {
    val startElapsedMs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      Process.getStartRequestedElapsedRealtime()
    } else {
      Process.getStartElapsedRealtime()
    }
    return (System.currentTimeMillis() - (SystemClock.elapsedRealtime() - startElapsedMs)).toDouble()
  }

  /**
   * True when Android 15+ (API 35) records that this process was started for something other than
   * an activity: a push, a broadcast, a job, a service, an alarm, a content provider. The user's
   * launch then resumed a process that already existed. False when unknown (older versions: the
   * JS side drops a process start more than 10 s before the JS entry instead).
   */
  fun wasStartedInBackground(context: Context?): Boolean {
    if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return false
    val manager = context.getSystemService(ActivityManager::class.java) ?: return false
    val start = manager.getHistoricalProcessStartReasons(1).firstOrNull() ?: return false
    return start.pid == Process.myPid() && start.reason !in LAUNCH_REASONS
  }

  /** The report header's device model, e.g. "Google Pixel 9". */
  fun deviceModel(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
}
