import ExpoModulesCore
import UIKit

/// Background time that iOS gives the app with `beginBackgroundTask`, about 30 seconds. A button of a
/// notification, also on a paired Apple Watch, starts the app in the background, and `expo-notifications`
/// tells iOS at once that it handled the button. Without this time, iOS can suspend the app before it
/// reaches the host. All calls run on the main queue.
final class BackgroundTime {
  static let shared = BackgroundTime()
  private var tasks = Set<UIBackgroundTaskIdentifier>()
  /// The time that a start in the background holds until JavaScript runs.
  private var launch: UIBackgroundTaskIdentifier?

  func begin(_ name: String) -> UIBackgroundTaskIdentifier {
    var identifier = UIBackgroundTaskIdentifier.invalid
    identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
      // iOS ends the app when a task outlives its time.
      self?.end(identifier)
    }
    if identifier != .invalid { tasks.insert(identifier) }
    return identifier
  }

  func end(_ identifier: UIBackgroundTaskIdentifier) {
    guard tasks.remove(identifier) != nil else { return }
    if launch == identifier { launch = nil }
    UIApplication.shared.endBackgroundTask(identifier)
  }

  func beginLaunch() {
    guard launch == nil else { return }
    let identifier = begin("OpenBot background start")
    if identifier != .invalid { launch = identifier }
  }

  func endLaunch() {
    if let launch { end(launch) }
  }
}

public class BackgroundTimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotBackgroundTime")

    /// Returns the task, or -1 when iOS gives no time.
    AsyncFunction("begin") { (name: String) -> Int in
      let identifier = BackgroundTime.shared.begin(name)
      return identifier == .invalid ? -1 : identifier.rawValue
    }
    .runOnQueue(.main)

    AsyncFunction("end") { (identifier: Int) in
      BackgroundTime.shared.end(UIBackgroundTaskIdentifier(rawValue: identifier))
    }
    .runOnQueue(.main)

    /// JavaScript runs and holds its own time for each button now.
    AsyncFunction("endLaunch") {
      BackgroundTime.shared.endLaunch()
    }
    .runOnQueue(.main)
  }
}

public class BackgroundTimeAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // iOS starts the app in the background for a notification button. JavaScript must load before
    // it can answer, so the start holds time until JavaScript takes over or iOS ends it.
    if application.applicationState == .background { BackgroundTime.shared.beginLaunch() }
    return true
  }
}
