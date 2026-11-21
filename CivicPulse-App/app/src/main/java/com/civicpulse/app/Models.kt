package com.civicpulse.app

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.annotations.SerializedName

enum class AppTab(val label: String) {
    FEED("Live Feed"),
    REPORT("Report"),
    CHAT("AI Chat")
}

val INCIDENT_CATEGORIES = listOf("Disaster", "Nature", "Tourism", "Road")

data class LoginRequest(
    val email: String,
    val password: String
)

data class CreatePostRequest(
    val title: String,
    val description: String,
    @SerializedName("location_name") val locationName: String,
    val category: String,
    @SerializedName("user_lat") val userLat: Double,
    @SerializedName("user_lng") val userLng: Double,
    val lat: Double,
    val lng: Double,
    @SerializedName("media_base64") val mediaBase64: String? = null,
    @SerializedName("is_live_captured") val isLiveCaptured: Boolean = false
)

data class ChatRequest(
    val message: String
)

data class PostItem(
    val id: String,
    val title: String,
    val translatedDescription: String,
    val category: String,
    val locationName: String,
    val travelAdvisory: String,
    val severity: Int,
    val verificationStatus: String,
    val mediaUrl: String?,
    val isLiveCaptured: Boolean,
    val confirmations: Int?,
    val flags: Int?,
    val createdAt: String?
)

data class ChatMessage(
    val id: String,
    val isUser: Boolean,
    val isError: Boolean = false,
    val text: String,
    val timestamp: String
)

data class GpsState(
    val lat: Double,
    val lng: Double,
    val isFallback: Boolean,
    val statusLabel: String
)

object ApiParsers {

    fun extractToken(element: JsonElement?): String? {
        val obj = element.asObjectOrNull() ?: return null
        val nestedData = obj.get("data").asObjectOrNull()
        return listOfNotNull(
            obj.optString("token"),
            obj.optString("access_token"),
            obj.optString("accessToken"),
            obj.optString("jwt"),
            nestedData?.optString("token"),
            nestedData?.optString("access_token"),
            nestedData?.optString("accessToken")
        ).firstOrNull { it.isNotBlank() }
    }

    fun parsePosts(element: JsonElement?): List<PostItem> {
        val array = extractPostsArray(element) ?: return emptyList()
        return array.mapIndexedNotNull { index, item ->
            val obj = item.asObjectOrNull() ?: return@mapIndexedNotNull null
            val id = obj.optString("id") ?: obj.optString("_id") ?: index.toString()
            val title = obj.optString("title")?.ifBlank { null } ?: "Untitled Report"
            val translatedDesc = obj.optString("translated_description")?.ifBlank { null }
                ?: obj.optString("description")
                ?: ""
            val category = obj.optString("category")?.ifBlank { null } ?: "General"
            val locationName = obj.optString("location_name")?.ifBlank { null } ?: "Unknown location"
            val travelAdvisory = obj.optString("travel_advisory")?.ifBlank { null } ?: "Advisory"
            val severity = (obj.optInt("severity") ?: 0).coerceIn(0, 10)
            val verificationStatus = obj.optString("verification_status")?.ifBlank { null } ?: "Unverified"
            val mediaUrl = obj.optString("media_url")?.ifBlank { null }
            val isLiveCaptured = obj.optBoolean("is_live_captured") ?: false
            val confirmations = obj.optInt("confirmations")
                ?: obj.optInt("verify_count")
                ?: obj.optInt("verifications")
                ?: obj.optInt("verified_count")
            val flags = obj.optInt("flags") ?: obj.optInt("flag_count")
            val createdAt = obj.optString("created_at")?.ifBlank { null }

            PostItem(
                id = id,
                title = title,
                translatedDescription = translatedDesc,
                category = category,
                locationName = locationName,
                travelAdvisory = travelAdvisory,
                severity = severity,
                verificationStatus = verificationStatus,
                mediaUrl = mediaUrl,
                isLiveCaptured = isLiveCaptured,
                confirmations = confirmations,
                flags = flags,
                createdAt = createdAt
            )
        }
    }

    fun extractChatReply(element: JsonElement?): String {
        if (element == null || element.isJsonNull) return ""
        if (element.isJsonPrimitive) {
            return element.asString
        }
        val obj = element.asObjectOrNull() ?: return element.toString()
        val nestedData = obj.get("data").asObjectOrNull()
        return listOfNotNull(
            obj.optString("reply"),
            obj.optString("response"),
            obj.optString("message"),
            obj.optString("answer"),
            obj.optString("text"),
            obj.optString("content"),
            nestedData?.optString("reply"),
            nestedData?.optString("response"),
            nestedData?.optString("message")
        ).firstOrNull { it.isNotBlank() } ?: obj.toString()
    }

    fun extractErrorMessage(errorBody: String?, code: Int): String {
        val raw = errorBody?.trim().orEmpty()
        if (raw.isNotEmpty()) {
            val parsed = runCatching { JsonParser.parseString(raw) }.getOrNull().asObjectOrNull()
            val message = parsed?.let { obj ->
                obj.optString("error")
                    ?: obj.optString("message")
                    ?: obj.optString("detail")
            }
            if (!message.isNullOrBlank()) return message
            if (!raw.startsWith("<") && raw.length <= 180) return raw
        }
        return "Request failed with HTTP $code"
    }

    private fun extractPostsArray(element: JsonElement?): JsonArray? {
        if (element == null || element.isJsonNull) return null
        if (element.isJsonArray) return element.asJsonArray
        val obj = element.asObjectOrNull() ?: return null
        val keys = listOf("posts", "data", "items")
        for (key in keys) {
            val candidate = obj.get(key)
            if (candidate != null && candidate.isJsonArray) {
                return candidate.asJsonArray
            }
        }
        return null
    }

    private fun JsonElement?.asObjectOrNull(): JsonObject? =
        if (this != null && isJsonObject) asJsonObject else null

    private fun JsonObject.optString(key: String): String? {
        val value = get(key) ?: return null
        return if (value.isJsonPrimitive) value.asString else null
    }

    private fun JsonObject.optInt(key: String): Int? {
        val value = get(key) ?: return null
        if (!value.isJsonPrimitive) return null
        val prim = value.asJsonPrimitive
        return when {
            prim.isNumber -> prim.asDouble.toInt()
            prim.isString -> prim.asString.toDoubleOrNull()?.toInt()
            else -> null
        }
    }

    private fun JsonObject.optBoolean(key: String): Boolean? {
        val value = get(key) ?: return null
        if (!value.isJsonPrimitive) return null
        val prim = value.asJsonPrimitive
        return when {
            prim.isBoolean -> prim.asBoolean
            prim.isNumber -> prim.asInt != 0
            prim.isString -> prim.asString.equals("true", ignoreCase = true) || prim.asString == "1"
            else -> null
        }
    }
}
