// modules/task-checksum/cpp/task-checksum.cpp
#include "task-checksum.h"

#include <cstdint>
#include <cstdio>

namespace taskchecksum {

std::string checksum(const std::string &text) {
  std::uint64_t hash = 0xcbf29ce484222325ULL;
  for (unsigned char byte : text) {
    hash ^= byte;
    hash *= 0x100000001b3ULL;
  }
  char out[17];
  std::snprintf(out, sizeof(out), "%016llx", static_cast<unsigned long long>(hash));
  return std::string(out);
}

} // namespace taskchecksum
