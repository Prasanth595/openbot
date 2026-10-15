import AVFoundation
import ExpoModulesCore

public class QrCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotQrCamera")

    // Expo's selectedLens matches localizedName. Device types identify the lens here, so
    // the scanner does not need to guess a translated name or the order of Expo's lens list.
    Function("preferredLens") { () -> String? in
      for deviceType in [AVCaptureDevice.DeviceType.builtInTripleCamera, .builtInDualWideCamera] {
        guard let camera = AVCaptureDevice.default(deviceType, for: .video, position: .back),
              camera.isFocusModeSupported(.continuousAutoFocus) else { continue }

        let hasAutofocusUltraWide = camera.constituentDevices.contains {
          $0.deviceType == .builtInUltraWideCamera && $0.isFocusModeSupported(.continuousAutoFocus)
        }
        if hasAutofocusUltraWide { return camera.localizedName }
      }

      // Older phones have a fixed-focus ultra-wide camera, or no virtual camera.
      return nil
    }
  }
}
