package com.civicpulse.app

/**
 * Swap this single constant to your teammate's Cloudflare HTTPS tunnel URL
 * (for example: "https://your-tunnel-name.trycloudflare.com/").
 */
const val API_BASE_URL = "http://10.0.2.2:8080/"

const val DEFAULT_SRI_LANKA_LAT = 6.9271
const val DEFAULT_SRI_LANKA_LNG = 79.8612

const val DEMO_EMAIL = "user@civicpulse.org"
const val DEMO_PASSWORD = "user123"

fun normalizedBaseUrl(): String {
    val trimmed = API_BASE_URL.trim()
    return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
}

fun resolveMediaUrl(mediaUrl: String?): String? {
    val raw = mediaUrl?.trim().orEmpty()
    if (raw.isEmpty()) return null
    return when {
        raw.startsWith("/uploads/") -> "${API_BASE_URL.trim().trimEnd('/')}$raw"
        raw.startsWith("/") -> "${API_BASE_URL.trim().trimEnd('/')}$raw"
        raw.startsWith("uploads/") -> "${normalizedBaseUrl()}$raw"
        else -> raw
    }
}
