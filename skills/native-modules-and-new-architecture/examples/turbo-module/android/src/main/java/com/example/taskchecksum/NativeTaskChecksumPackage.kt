// modules/task-checksum/android/src/main/java/com/example/taskchecksum/NativeTaskChecksumPackage.kt
// The Turbo Module package autolinking registers (BaseReactPackage, isTurboModule = true).
package com.example.taskchecksum

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NativeTaskChecksumPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == NativeTaskChecksumModule.NAME) NativeTaskChecksumModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      NativeTaskChecksumModule.NAME to ReactModuleInfo(
        NativeTaskChecksumModule.NAME,
        NativeTaskChecksumModule.NAME,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        true, // isTurboModule
      ),
    )
  }
}
