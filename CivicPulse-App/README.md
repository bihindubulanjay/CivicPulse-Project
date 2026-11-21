# CivicPulse Android (Kotlin + Jetpack Compose)

Native dark-mode Material 3 Android client for **CivicPulse** — real-time community crisis & safety reporting.

## Configure Backend URL

Open `app/src/main/java/com/civicpulse/app/ApiConfig.kt` and update `API_BASE_URL`:

```kotlin
const val API_BASE_URL = "http://10.0.2.2:8080/"
```

- Android Emulator (`localhost` on host machine): `"http://10.0.2.2:8080/"`
- Physical device via Cloudflare HTTPS Tunnel: `"https://your-tunnel.trycloudflare.com/"`

`AndroidManifest.xml` has `android:usesCleartextTraffic="true"` enabled so both HTTP and HTTPS URLs work out of the box.

## Running in Android Studio

1. Open `C:\Users\Admin\Downloads\CivilPlusKotlin` in Android Studio (JDK 17, Android SDK 35).
2. Let Gradle sync (`AGP 8.7.3`, `Kotlin 2.0.21`, `Compose BOM 2024.12.01`).
3. Run the `app` configuration on an emulator or physical Android device (`minSdk 24`).

## Included Features

- **Auto-Login + 1-Tap Demo Login**: Calls `POST /api/auth/login` with `user@civicpulse.org` / `user123`, persists the Bearer token in `SharedPreferences`, and attaches `Authorization: Bearer <token>` to `POST /api/posts`, `POST /api/posts/{id}/verify`, and `POST /api/posts/{id}/flag`.
- **Tab 1 — Live Feed**: `GET /api/posts?sort=priority&limit=20` with category filters, Coil image loading (auto-prepending `API_BASE_URL` for `/uploads/`), color-coded `travel_advisory` badges (`Safe` green, `Caution` yellow, `Danger` red), severity `1–10` progress bar, `verification_status`, and **Confirm** / **Flag** buttons.
- **Tab 2 — Report Incident**: Inputs for title, description, location name, category dropdown (`Disaster`, `Nature`, `Tourism`, `Road`), `TakePicturePreview()` live photo capture encoded as `data:image/jpeg;base64,...` (`is_live_captured = true`), and `FusedLocationProviderClient` GPS with automatic fallback to Sri Lanka coordinates (`6.9271, 79.8612`).
- **Tab 3 — AI Safety Chat**: `POST /api/ai/chat` dark-mode chat screen displaying Gemini safety responses.
