// modules/task-checksum/android/src/main/cpp/task-checksum-jni.cpp
// The JNI bridge from Kotlin (TaskChecksumJni.checksum) to the shared C++ in cpp/: Android calls the
// same checksum() as iOS, so the two platforms cannot drift apart. Kotlin passes the text's UTF-8
// bytes (String.toByteArray(UTF_8)), not a jstring, because GetStringUTFChars returns modified UTF-8
// (a NUL is two bytes, an emoji six), which would hash differently from iOS's UTF8String.
#include <jni.h>

#include <string>

#include "task-checksum.h"

extern "C" JNIEXPORT jstring JNICALL
Java_com_example_taskchecksum_TaskChecksumJni_checksum(JNIEnv *env, jclass /* cls */, jbyteArray utf8) {
  const jsize length = env->GetArrayLength(utf8);
  std::string bytes(static_cast<size_t>(length), '\0');
  env->GetByteArrayRegion(utf8, 0, length, reinterpret_cast<jbyte *>(bytes.data()));
  const std::string digest = taskchecksum::checksum(bytes);
  return env->NewStringUTF(digest.c_str()); // hex digits: plain ASCII, so modified UTF-8 is exact
}
