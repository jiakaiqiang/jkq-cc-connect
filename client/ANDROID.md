# Android APK Build

## What this does

The `client` app can be packaged as an Android APK with Capacitor.
The APK connects to the desktop server over HTTP/WebSocket, so the phone must be able to reach the computer running the `server` workspace.

Example desktop server address:

```text
http://192.168.1.8:3000
```

## Scripts

From the repo root:

```bash
npm run android:sync -w client
npm run android:open -w client
npm run android:apk -w client
```

## Requirements

- Java JDK
- Android Studio
- Android SDK
- `adb` in PATH

## APK output

After a successful debug build, the APK is typically generated at:

```text
client/android/app/build/outputs/apk/debug/app-debug.apk
```

## First launch on phone

1. Open the app
2. Enter the desktop server address
3. Test the connection
4. Sign in with the server password

## Notes

- The Android shell allows cleartext HTTP so local LAN addresses like `http://192.168.x.x:3000` can be used.
- If the desktop server address changes, update it from the login page or settings page.
