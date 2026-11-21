package com.civicpulse.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.location.Location
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.resume

data class CivicPulseUiState(
    val activeTab: AppTab = AppTab.FEED,
    val authToken: String? = null,
    val isLoggingIn: Boolean = false,
    val posts: List<PostItem> = emptyList(),
    val selectedCategoryFilter: String = "All",
    val isFeedLoading: Boolean = false,
    val feedError: String? = null,
    val busyPostId: String? = null,
    val busyActionType: String? = null,
    val reportTitle: String = "",
    val reportDescription: String = "",
    val reportLocationName: String = "",
    val reportCategory: String = INCIDENT_CATEGORIES.first(),
    val capturedBitmap: Bitmap? = null,
    val mediaBase64: String? = null,
    val isLiveCaptured: Boolean = false,
    val isEncodingPhoto: Boolean = false,
    val gpsState: GpsState? = null,
    val isGrabbingGps: Boolean = false,
    val isSubmittingReport: Boolean = false,
    val reportError: String? = null,
    val chatMessages: List<ChatMessage> = listOf(createWelcomeMessage()),
    val isChatSending: Boolean = false,
    val snackbarMessage: String? = null
)

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val tokenStore = TokenStore(application)
    private val api = ApiClient.service

    private val _uiState = MutableStateFlow(
        CivicPulseUiState(authToken = tokenStore.getToken())
    )
    val uiState: StateFlow<CivicPulseUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            demoLogin(silent = true)
        }
        loadFeed()
    }

    fun selectTab(tab: AppTab) {
        _uiState.update { it.copy(activeTab = tab) }
    }

    fun selectCategoryFilter(category: String) {
        _uiState.update { it.copy(selectedCategoryFilter = category) }
    }

    fun consumeSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }

    fun showMessage(message: String) {
        _uiState.update { it.copy(snackbarMessage = message) }
    }

    fun triggerDemoLogin() {
        viewModelScope.launch {
            demoLogin(silent = false)
        }
    }

    suspend fun demoLogin(silent: Boolean = false): String? {
        _uiState.update { it.copy(isLoggingIn = true) }
        return try {
            val response = api.login(LoginRequest(DEMO_EMAIL, DEMO_PASSWORD))
            if (response.isSuccessful) {
                val token = ApiParsers.extractToken(response.body())
                if (!token.isNullOrBlank()) {
                    tokenStore.saveToken(token)
                    _uiState.update {
                        it.copy(
                            authToken = token,
                            isLoggingIn = false,
                            snackbarMessage = if (!silent) "Demo session active" else it.snackbarMessage
                        )
                    }
                    token
                } else {
                    _uiState.update {
                        it.copy(
                            isLoggingIn = false,
                            snackbarMessage = if (!silent) "Login succeeded but no token returned" else it.snackbarMessage
                        )
                    }
                    null
                }
            } else {
                val err = ApiParsers.extractErrorMessage(response.errorBody()?.string(), response.code())
                _uiState.update {
                    it.copy(
                        isLoggingIn = false,
                        snackbarMessage = if (!silent) "Login failed: $err" else it.snackbarMessage
                    )
                }
                null
            }
        } catch (e: Exception) {
            _uiState.update {
                it.copy(
                    isLoggingIn = false,
                    snackbarMessage = if (!silent) "Login error: ${e.localizedMessage ?: "Network unavailable"}" else it.snackbarMessage
                )
            }
            null
        }
    }

    private suspend fun ensureBearerHeader(): String? {
        tokenStore.bearerHeader()?.let { return it }
        val fresh = demoLogin(silent = true)
        return fresh?.takeIf { it.isNotBlank() }?.let { "Bearer $it" }
    }

    fun loadFeed() {
        viewModelScope.launch {
            _uiState.update { it.copy(isFeedLoading = true, feedError = null) }
            try {
                val response = api.getPosts(sort = "priority", limit = 20)
                if (response.isSuccessful) {
                    val parsed = ApiParsers.parsePosts(response.body())
                    _uiState.update {
                        it.copy(
                            posts = parsed,
                            isFeedLoading = false,
                            feedError = null
                        )
                    }
                } else {
                    val err = ApiParsers.extractErrorMessage(response.errorBody()?.string(), response.code())
                    _uiState.update {
                        it.copy(isFeedLoading = false, feedError = err)
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isFeedLoading = false,
                        feedError = e.localizedMessage ?: "Unable to connect to CivicPulse server."
                    )
                }
            }
        }
    }

    fun verifyPost(postId: String) {
        performPostAction(postId = postId, type = "verify")
    }

    fun flagPost(postId: String) {
        performPostAction(postId = postId, type = "flag")
    }

    private fun performPostAction(postId: String, type: String) {
        if (_uiState.value.busyPostId != null) return
        viewModelScope.launch {
            _uiState.update { it.copy(busyPostId = postId, busyActionType = type) }
            try {
                val authHeader = ensureBearerHeader()
                val response = if (type == "verify") {
                    api.verifyPost(postId, authHeader)
                } else {
                    api.flagPost(postId, authHeader)
                }

                if (response.isSuccessful) {
                    _uiState.update {
                        it.copy(
                            busyPostId = null,
                            busyActionType = null,
                            snackbarMessage = if (type == "verify") "Report confirmed" else "Report flagged for review"
                        )
                    }
                    loadFeed()
                } else {
                    val err = ApiParsers.extractErrorMessage(response.errorBody()?.string(), response.code())
                    _uiState.update {
                        it.copy(
                            busyPostId = null,
                            busyActionType = null,
                            snackbarMessage = err
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        busyPostId = null,
                        busyActionType = null,
                        snackbarMessage = e.localizedMessage ?: "Action failed"
                    )
                }
            }
        }
    }

    fun updateReportTitle(value: String) {
        _uiState.update { it.copy(reportTitle = value, reportError = null) }
    }

    fun updateReportDescription(value: String) {
        _uiState.update { it.copy(reportDescription = value, reportError = null) }
    }

    fun updateReportLocationName(value: String) {
        _uiState.update { it.copy(reportLocationName = value, reportError = null) }
    }

    fun updateReportCategory(value: String) {
        _uiState.update { it.copy(reportCategory = value, reportError = null) }
    }

    fun onPhotoCaptured(bitmap: Bitmap) {
        viewModelScope.launch {
            _uiState.update { it.copy(isEncodingPhoto = true, reportError = null) }
            val encodedDataUri = withContext(Dispatchers.Default) {
                val output = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output)
                val bytes = output.toByteArray()
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                "data:image/jpeg;base64,$b64"
            }
            _uiState.update {
                it.copy(
                    capturedBitmap = bitmap,
                    mediaBase64 = encodedDataUri,
                    isLiveCaptured = true,
                    isEncodingPhoto = false,
                    snackbarMessage = "Live photo captured"
                )
            }
        }
    }

    fun clearPhoto() {
        _uiState.update {
            it.copy(
                capturedBitmap = null,
                mediaBase64 = null,
                isLiveCaptured = false
            )
        }
    }

    @SuppressLint("MissingPermission")
    fun grabGpsLocation(context: Context) {
        val hasFine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            applyFallbackGps("Location permission denied — using Sri Lanka demo GPS")
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isGrabbingGps = true, reportError = null) }
            val client = LocationServices.getFusedLocationProviderClient(context.applicationContext)
            val cts = CancellationTokenSource()

            val location = try {
                val current = withTimeoutOrNull(5_000L) {
                    client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                        .awaitNullable(cts)
                }
                current ?: withTimeoutOrNull(2_000L) {
                    client.lastLocation.awaitNullable()
                }
            } catch (_: Exception) {
                null
            } finally {
                cts.cancel()
            }

            if (location != null) {
                val lat = round6(location.latitude)
                val lng = round6(location.longitude)
                _uiState.update {
                    it.copy(
                        isGrabbingGps = false,
                        gpsState = GpsState(
                            lat = lat,
                            lng = lng,
                            isFallback = false,
                            statusLabel = "Live GPS Lock"
                        ),
                        snackbarMessage = "GPS locked ($lat, $lng)"
                    )
                }
            } else {
                applyFallbackGps("GPS unavailable indoors — using Sri Lanka fallback")
            }
        }
    }

    fun applyFallbackGps(reason: String) {
        _uiState.update {
            it.copy(
                isGrabbingGps = false,
                gpsState = GpsState(
                    lat = DEFAULT_SRI_LANKA_LAT,
                    lng = DEFAULT_SRI_LANKA_LNG,
                    isFallback = true,
                    statusLabel = "Sri Lanka Fallback (Colombo)"
                ),
                snackbarMessage = reason
            )
        }
    }

    fun submitReport() {
        val state = _uiState.value
        val cleanTitle = state.reportTitle.trim()
        val cleanDescription = state.reportDescription.trim()
        val cleanLocation = state.reportLocationName.trim()
        val cleanCategory = state.reportCategory.trim()

        if (cleanTitle.isEmpty() || cleanDescription.isEmpty() || cleanLocation.isEmpty()) {
            _uiState.update {
                it.copy(reportError = "Please enter title, location name, and description.")
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingReport = true, reportError = null) }
            try {
                val authHeader = ensureBearerHeader()
                if (authHeader.isNullOrBlank()) {
                    _uiState.update {
                        it.copy(
                            isSubmittingReport = false,
                            reportError = "Demo login required so reports bypass Guest moderation. Tap Demo Login in the top bar."
                        )
                    }
                    return@launch
                }

                val activeGps = state.gpsState ?: GpsState(
                    lat = DEFAULT_SRI_LANKA_LAT,
                    lng = DEFAULT_SRI_LANKA_LNG,
                    isFallback = true,
                    statusLabel = "Sri Lanka Default"
                )

                val request = CreatePostRequest(
                    title = cleanTitle,
                    description = cleanDescription,
                    locationName = cleanLocation,
                    category = cleanCategory,
                    userLat = activeGps.lat,
                    userLng = activeGps.lng,
                    lat = activeGps.lat,
                    lng = activeGps.lng,
                    mediaBase64 = state.mediaBase64,
                    isLiveCaptured = state.isLiveCaptured
                )

                val response = api.createPost(authHeader, request)
                if (response.isSuccessful) {
                    _uiState.update {
                        it.copy(
                            isSubmittingReport = false,
                            reportTitle = "",
                            reportDescription = "",
                            reportLocationName = "",
                            reportCategory = INCIDENT_CATEGORIES.first(),
                            capturedBitmap = null,
                            mediaBase64 = null,
                            isLiveCaptured = false,
                            gpsState = activeGps,
                            reportError = null,
                            activeTab = AppTab.FEED,
                            snackbarMessage = "Report published to Live Feed!"
                        )
                    }
                    loadFeed()
                } else {
                    val err = ApiParsers.extractErrorMessage(response.errorBody()?.string(), response.code())
                    _uiState.update {
                        it.copy(isSubmittingReport = false, reportError = err)
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isSubmittingReport = false,
                        reportError = e.localizedMessage ?: "Failed to publish report."
                    )
                }
            }
        }
    }

    fun sendChatMessage(rawText: String) {
        val text = rawText.trim()
        if (text.isEmpty() || _uiState.value.isChatSending) return

        val userMsg = ChatMessage(
            id = "user-${System.currentTimeMillis()}",
            isUser = true,
            text = text,
            timestamp = formatNow()
        )

        _uiState.update {
            it.copy(
                chatMessages = it.chatMessages + userMsg,
                isChatSending = true
            )
        }

        viewModelScope.launch {
            try {
                val authHeader = tokenStore.bearerHeader()
                val response = api.sendChat(authHeader, ChatRequest(message = text))
                if (response.isSuccessful) {
                    val reply = ApiParsers.extractChatReply(response.body())
                        .ifBlank { "No response received." }
                    val aiMsg = ChatMessage(
                        id = "ai-${System.currentTimeMillis()}",
                        isUser = false,
                        text = reply,
                        timestamp = formatNow()
                    )
                    _uiState.update {
                        it.copy(
                            chatMessages = it.chatMessages + aiMsg,
                            isChatSending = false
                        )
                    }
                } else {
                    val err = ApiParsers.extractErrorMessage(response.errorBody()?.string(), response.code())
                    val errMsg = ChatMessage(
                        id = "err-${System.currentTimeMillis()}",
                        isUser = false,
                        isError = true,
                        text = err,
                        timestamp = formatNow()
                    )
                    _uiState.update {
                        it.copy(
                            chatMessages = it.chatMessages + errMsg,
                            isChatSending = false
                        )
                    }
                }
            } catch (e: Exception) {
                val errMsg = ChatMessage(
                    id = "err-${System.currentTimeMillis()}",
                    isUser = false,
                    isError = true,
                    text = e.localizedMessage ?: "Could not reach AI Safety Assistant.",
                    timestamp = formatNow()
                )
                _uiState.update {
                    it.copy(
                        chatMessages = it.chatMessages + errMsg,
                        isChatSending = false
                    )
                }
            }
        }
    }

    fun resetChat() {
        if (_uiState.value.isChatSending) return
        _uiState.update {
            it.copy(chatMessages = listOf(createWelcomeMessage()))
        }
    }

    private suspend fun Task<Location>.awaitNullable(
        cts: CancellationTokenSource? = null
    ): Location? = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cts?.cancel() }
        addOnSuccessListener { result ->
            if (cont.isActive) cont.resume(result)
        }
        addOnFailureListener {
            if (cont.isActive) cont.resume(null)
        }
        addOnCanceledListener {
            if (cont.isActive) cont.resume(null)
        }
    }

    private fun round6(value: Double): Double = kotlin.math.round(value * 1_000_000.0) / 1_000_000.0

    private companion object {
        fun formatNow(): String =
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())

        fun createWelcomeMessage(): ChatMessage = ChatMessage(
            id = "welcome-ai",
            isUser = false,
            text = "Hi, I'm CivicPulse AI Safety powered by Gemini. Ask me about local hazards, safe routes, or emergency guidance.",
            timestamp = formatNow()
        )
    }
}
