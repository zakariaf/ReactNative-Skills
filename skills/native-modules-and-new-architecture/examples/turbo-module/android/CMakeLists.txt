# modules/task-checksum/android/CMakeLists.txt
# Builds libtaskchecksum.so from the shared C++ (../cpp) and its JNI bridge. The library links only the
# C++ standard library and talks to Kotlin through a C (JNI) interface, so the static libc++ is safe
# beside React Native's shared one (no C++ object crosses the library boundary).
cmake_minimum_required(VERSION 3.13)
project(taskchecksum CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(taskchecksum SHARED
  ../cpp/task-checksum.cpp
  src/main/cpp/task-checksum-jni.cpp
)
target_include_directories(taskchecksum PRIVATE ../cpp)
