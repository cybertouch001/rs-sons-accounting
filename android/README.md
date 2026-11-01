# R&S Sons Accounting for Android

A small native shell (Java, no extra libraries) around the hosted web app. It handles:
- login persistence (cookies flushed on pause);
- the Android back button (handed to the app first, then press back twice to exit);
- Downloads saving (MediaStore on Android 10+);
- PDF share via an offscreen print-to-PDF;
- the app lock (BiometricPrompt, or the phone's PIN/pattern);
- connecting / server-waking / offline screens.

Build (JDK 17, Android SDK 35):

    export RS_SIGNING_PROPS=/safe/place/signing.properties   # storeFile, storePassword, keyAlias, keyPassword
    ./gradlew assembleRelease                                 # app/build/outputs/apk/release/app-release.apk

Optional build settings:
- `RS_SERVER=https://your-server` builds for a self-hosted server.
- `RS_WEBDEBUG=1` is for test builds only.

**Keep the signing key safe.** Every update must be signed with the same key, or phones refuse to install it over the old app.
