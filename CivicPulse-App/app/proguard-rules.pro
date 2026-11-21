# Keep Gson request/response models and annotations intact when R8/ProGuard runs.
-keep class com.civicpulse.app.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
