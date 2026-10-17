// modules/task-checksum/android/src/main/java/com/example/taskchecksum/TaskChecksumJni.kt
// The Kotlin face of the shared C++: loads libtaskchecksum.so (android/CMakeLists.txt) once and
// declares the JNI function android/src/main/cpp/task-checksum-jni.cpp implements.
package com.example.taskchecksum

internal object TaskChecksumJni {
  init {
    System.loadLibrary("taskchecksum")
  }

  /** FNV-1a 64-bit of `utf8`, as 16 lowercase hex digits, computed by cpp/task-checksum.cpp. */
  @JvmStatic external fun checksum(utf8: ByteArray): String
}
