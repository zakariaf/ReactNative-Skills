// modules/task-checksum/cpp/task-checksum.h
// The shared C++ both platforms call (iOS from Objective-C++, Android through JNI in
// android/src/main/cpp): the reason this module is a Turbo Module and not an Expo module.
#pragma once

#include <string>

namespace taskchecksum {

/** FNV-1a 64-bit over the bytes of `text`, as 16 lowercase hex digits. */
std::string checksum(const std::string &text);

} // namespace taskchecksum
