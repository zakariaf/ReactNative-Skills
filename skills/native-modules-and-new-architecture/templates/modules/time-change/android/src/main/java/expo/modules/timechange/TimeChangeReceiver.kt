// modules/time-change/android/src/main/java/expo/modules/timechange/TimeChangeReceiver.kt
// A context-registered receiver for the three time broadcasts; unregister() releases it. Only
// android.* types, so it compiles on its own against the platform's android.jar.
package expo.modules.timechange

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build

internal class TimeChangeReceiver private constructor(
  private val context: Context,
  private val onChange: (String) -> Unit,
) : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    TimeChangeSystem.REASONS[intent.action]?.let(onChange)
  }

  fun unregister() {
    context.unregisterReceiver(this)
  }

  companion object {
    fun register(context: Context, onChange: (String) -> Unit): TimeChangeReceiver {
      val appContext = context.applicationContext
      val receiver = TimeChangeReceiver(appContext, onChange)
      val filter = IntentFilter().apply { TimeChangeSystem.REASONS.keys.forEach(::addAction) }
      // The system sends these broadcasts (protected actions no other app may send), so the receiver
      // is exported: a not-exported receiver misses broadcasts from privileged senders.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        appContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        appContext.registerReceiver(receiver, filter)
      }
      return receiver
    }
  }
}
