import AppKit
import CoreLocation
import Foundation

final class LocationApp: NSObject, NSApplicationDelegate, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    let geocoder = CLGeocoder()
    var finished = false
    var requested = false
    var authorizationRequested = false
    var mayRequestPermission = false
    var requestID = ""
    var resultURL: URL!
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let index = CommandLine.arguments.firstIndex(of: "--request-id"), index + 1 < CommandLine.arguments.count,
              UUID(uuidString: CommandLine.arguments[index + 1]) != nil else { NSApp.terminate(nil); return }
        requestID = CommandLine.arguments[index + 1]
        mayRequestPermission = CommandLine.arguments.contains("--request-permission")
        let root: URL
        if let index = CommandLine.arguments.firstIndex(of: "--data-root"), index + 1 < CommandLine.arguments.count,
           CommandLine.arguments[index + 1].hasPrefix("/") {
            root = URL(fileURLWithPath: CommandLine.arguments[index + 1])
        } else {
            root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/LilithAI")
        }
        let folder = root.appendingPathComponent("location/requests", isDirectory: true)
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { NSApp.terminate(nil); return }
        resultURL = folder.appendingPathComponent(requestID + ".json")
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { self.finish(["status": "timeout"]) }
        if !CLLocationManager.locationServicesEnabled() { finish(["status": "services_disabled"]); return }
        authorize()
    }
    func authorize() {
        let status = manager.authorizationStatus
        if status == .authorizedAlways {
            if !requested { requested = true; manager.requestLocation() }
        } else if status == .notDetermined {
            if mayRequestPermission {
                if !authorizationRequested {
                    authorizationRequested = true
                    NSApp.activate(ignoringOtherApps: true)
                    manager.requestWhenInUseAuthorization()
                }
            } else { finish(["status": "permission_required"]) }
        }
        else { finish(["status": "permission_denied"]) }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { if resultURL != nil { authorize() } }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        finish(["status": code == .denied ? "permission_denied" : "unavailable"])
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 50000,
              abs(location.timestamp.timeIntervalSinceNow) < 600 else { finish(["status": "no_fresh_fix"]); return }
        manager.stopUpdatingLocation()
        // Only coarse coordinates go to reverse geocoding and the weather host.
        let latitude = (location.coordinate.latitude * 10).rounded() / 10
        let longitude = (location.coordinate.longitude * 10).rounded() / 10
        var result: [String: Any] = ["status": "available", "latitude": latitude,
            "longitude": longitude, "accuracy_m": max(10000, location.horizontalAccuracy),
            "observed_at": location.timestamp.timeIntervalSince1970 * 1000, "precision": "rounded_0.1_degree"]
        geocoder.reverseGeocodeLocation(CLLocation(latitude: latitude, longitude: longitude)) { places, _ in
            if let place = places?.first {
                result["city"] = place.locality ?? place.administrativeArea ?? ""
                result["country_code"] = place.isoCountryCode ?? ""
            }
            self.finish(result)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.finish(result) }
    }
    func finish(_ body: [String: Any]) {
        guard !finished, resultURL != nil else { return }
        finished = true; manager.stopUpdatingLocation(); geocoder.cancelGeocode()
        var data = body; data["request_id"] = requestID; data["at"] = Date().timeIntervalSince1970 * 1000
        do {
            let bytes = try JSONSerialization.data(withJSONObject: data)
            try bytes.write(to: resultURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: resultURL.path)
        } catch { }
        NSApp.terminate(nil)
    }
}
let app = NSApplication.shared
let delegate = LocationApp()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
