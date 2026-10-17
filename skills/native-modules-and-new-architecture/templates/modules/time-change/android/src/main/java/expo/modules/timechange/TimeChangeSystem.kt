// modules/time-change/android/src/main/java/expo/modules/timechange/TimeChangeSystem.kt
// What Android says about time changes. Only android.* and java.* types, no Expo types, so it
// compiles on its own against the platform's android.jar.
package expo.modules.timechange

import android.content.ContentResolver
import android.content.Intent
import android.provider.Settings
import java.util.TimeZone

internal object TimeChangeSystem {
  /** Intent actions and the reason each one means: the same strings as the iOS side and the port. */
  val REASONS: Map<String, String> = mapOf(
    Intent.ACTION_TIMEZONE_CHANGED to "time-zone",
    Intent.ACTION_TIME_CHANGED to "clock-set",
    Intent.ACTION_DATE_CHANGED to "day-change",
  )

  /** The IANA time zone id now ("Europe/Berlin"); Android resets the default zone on a change. */
  fun currentTimeZoneId(): String = TimeZone.getDefault().id

  /** True when "Set time automatically" is on (the default when the setting is missing). */
  fun isAutomaticTimeEnabled(resolver: ContentResolver): Boolean =
    Settings.Global.getInt(resolver, Settings.Global.AUTO_TIME, 1) == 1
}
