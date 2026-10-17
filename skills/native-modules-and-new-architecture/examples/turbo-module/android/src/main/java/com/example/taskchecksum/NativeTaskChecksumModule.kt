// modules/task-checksum/android/src/main/java/com/example/taskchecksum/NativeTaskChecksumModule.kt
// Extends the generated NativeTaskChecksumSpec: a renamed or missing method fails to compile.
// The work happens in the shared C++ (cpp/task-checksum.cpp), reached through JNI, exactly as iOS
// reaches it from Objective-C++: one algorithm for both platforms.
package com.example.taskchecksum

import com.facebook.react.bridge.ReactApplicationContext

class NativeTaskChecksumModule(reactContext: ReactApplicationContext) : NativeTaskChecksumSpec(reactContext) {
  override fun getName(): String = NAME

  override fun checksum(text: String): String = TaskChecksumJni.checksum(text.toByteArray(Charsets.UTF_8))

  companion object {
    const val NAME = "NativeTaskChecksum"
  }
}
