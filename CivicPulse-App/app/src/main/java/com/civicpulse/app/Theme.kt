package com.civicpulse.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val BgDeep = Color(0xFF090D16)
val SurfaceCard = Color(0xFF111827)
val SurfaceInput = Color(0xFF0F172A)
val SurfaceNav = Color(0xFF0D1322)
val BorderSubtle = Color(0xFF1E293B)

val AccentEmerald = Color(0xFF10B981)
val EmeraldLight = Color(0xFF34D399)
val AccentSky = Color(0xFF38BDF8)

val AdvisorySafe = Color(0xFF22C55E)
val AdvisoryCaution = Color(0xFFFACC15)
val AdvisoryDanger = Color(0xFFEF4444)

val TextPrimary = Color(0xFFF8FAFC)
val TextSecondary = Color(0xFF94A3B8)
val TextMuted = Color(0xFF64748B)

private val CivicPulseDarkColorScheme = darkColorScheme(
    primary = AccentEmerald,
    onPrimary = Color(0xFF042F22),
    primaryContainer = Color(0xFF064E3B),
    onPrimaryContainer = EmeraldLight,
    secondary = AccentSky,
    onSecondary = Color(0xFF082F49),
    background = BgDeep,
    onBackground = TextPrimary,
    surface = SurfaceCard,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceInput,
    onSurfaceVariant = TextSecondary,
    outline = BorderSubtle,
    error = AdvisoryDanger,
    onError = Color.White
)

@Composable
fun CivicPulseTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CivicPulseDarkColorScheme,
        content = content
    )
}
