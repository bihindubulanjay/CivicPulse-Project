package com.civicpulse.app

import android.content.Context
import com.google.gson.JsonElement
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

interface CivicPulseApiService {

    @POST("api/auth/login")
    suspend fun login(
        @Body request: LoginRequest
    ): Response<JsonElement>

    @GET("api/posts")
    suspend fun getPosts(
        @Query("sort") sort: String = "priority",
        @Query("limit") limit: Int = 20
    ): Response<JsonElement>

    @POST("api/posts/{id}/verify")
    suspend fun verifyPost(
        @Path("id") id: String,
        @Header("Authorization") authHeader: String?
    ): Response<JsonElement>

    @POST("api/posts/{id}/flag")
    suspend fun flagPost(
        @Path("id") id: String,
        @Header("Authorization") authHeader: String?
    ): Response<JsonElement>

    @POST("api/posts")
    suspend fun createPost(
        @Header("Authorization") authHeader: String?,
        @Body request: CreatePostRequest
    ): Response<JsonElement>

    @POST("api/ai/chat")
    suspend fun sendChat(
        @Header("Authorization") authHeader: String?,
        @Body request: ChatRequest
    ): Response<JsonElement>
}

class TokenStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Volatile
    private var cachedToken: String? = prefs.getString(KEY_BEARER_TOKEN, null)

    fun getToken(): String? = cachedToken?.takeIf { it.isNotBlank() }

    fun saveToken(token: String) {
        val clean = token.trim()
        cachedToken = clean
        prefs.edit().putString(KEY_BEARER_TOKEN, clean).apply()
    }

    fun clearToken() {
        cachedToken = null
        prefs.edit().remove(KEY_BEARER_TOKEN).apply()
    }

    fun bearerHeader(): String? = getToken()?.let { "Bearer $it" }

    private companion object {
        const val PREFS_NAME = "civicpulse_prefs"
        const val KEY_BEARER_TOKEN = "bearer_token"
    }
}

object ApiClient {

    private val okHttpClient: OkHttpClient by lazy {
        val logger = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(logger)
            .build()
    }

    private val retrofit: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(normalizedBaseUrl())
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    val service: CivicPulseApiService by lazy {
        retrofit.create(CivicPulseApiService::class.java)
    }
}
