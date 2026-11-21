package com.civicpulse.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddCircleOutline
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import java.util.Locale

private val FEED_FILTER_CATEGORIES = listOf("All") + INCIDENT_CATEGORIES

@Composable
fun LiveFeedScreen(
    uiState: CivicPulseUiState,
    onRefresh: () -> Unit,
    onSelectFilter: (String) -> Unit,
    onVerify: (String) -> Unit,
    onFlag: (String) -> Unit,
    onGoToReport: () -> Unit
) {
    val filteredPosts = remember(uiState.posts, uiState.selectedCategoryFilter) {
        if (uiState.selectedCategoryFilter == "All") {
            uiState.posts
        } else {
            val target = uiState.selectedCategoryFilter.lowercase(Locale.ROOT)
            uiState.posts.filter { it.category.trim().lowercase(Locale.ROOT) == target }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDeep)
    ) {
        // Header row + count + refresh
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Priority Live Feed",
                    color = TextPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Surface(
                    shape = CircleShape,
                    color = SurfaceCard,
                    border = BorderStroke(1.dp, BorderSubtle)
                ) {
                    Text(
                        text = filteredPosts.size.toString(),
                        color = TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 2.dp)
                    )
                }
            }

            Surface(
                shape = RoundedCornerShape(10.dp),
                color = SurfaceCard,
                border = BorderStroke(1.dp, BorderSubtle),
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(enabled = !uiState.isFeedLoading, onClick = onRefresh)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (uiState.isFeedLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 2.dp,
                            color = AccentEmerald
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Rounded.Refresh,
                            contentDescription = "Refresh",
                            tint = AccentEmerald,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    Text(
                        text = "Refresh",
                        color = TextPrimary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        // Category Filter Chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FEED_FILTER_CATEGORIES.forEach { category ->
                val selected = uiState.selectedCategoryFilter == category
                Surface(
                    shape = CircleShape,
                    color = if (selected) AccentEmerald.copy(alpha = 0.18f) else SurfaceCard,
                    border = BorderStroke(
                        1.dp,
                        if (selected) AccentEmerald.copy(alpha = 0.6f) else BorderSubtle
                    ),
                    modifier = Modifier
                        .clip(CircleShape)
                        .clickable { onSelectFilter(category) }
                ) {
                    Text(
                        text = category,
                        color = if (selected) EmeraldLight else TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        when {
            uiState.isFeedLoading && uiState.posts.isEmpty() -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        CircularProgressIndicator(color = AccentEmerald)
                        Text(
                            text = "Loading prioritized safety reports...",
                            color = TextSecondary,
                            fontSize = 13.sp
                        )
                    }
                }
            }

            uiState.feedError != null && uiState.posts.isEmpty() -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = AdvisoryDanger.copy(alpha = 0.10f)
                        ),
                        border = BorderStroke(1.dp, AdvisoryDanger.copy(alpha = 0.35f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.WifiOff,
                                contentDescription = null,
                                tint = AdvisoryDanger,
                                modifier = Modifier.size(34.dp)
                            )
                            Text(
                                text = "Could not reach CivicPulse backend",
                                color = TextPrimary,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = uiState.feedError,
                                color = Color(0xFFFCA5A5),
                                fontSize = 12.sp
                            )
                            Text(
                                text = "Target: $API_BASE_URL",
                                color = TextSecondary,
                                fontSize = 11.sp
                            )
                            Button(
                                onClick = onRefresh,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = AdvisoryDanger.copy(alpha = 0.25f),
                                    contentColor = Color(0xFFFECACA)
                                )
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Refresh,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Retry")
                            }
                        }
                    }
                }
            }

            !uiState.isFeedLoading && filteredPosts.isEmpty() -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
                        border = BorderStroke(1.dp, BorderSubtle),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text(
                                text = if (uiState.posts.isEmpty()) {
                                    "No community reports yet"
                                } else {
                                    "No ${uiState.selectedCategoryFilter} reports right now"
                                },
                                color = TextPrimary,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = "Submit a live report with GPS and camera verification.",
                                color = TextSecondary,
                                fontSize = 12.sp
                            )
                            Button(
                                onClick = onGoToReport,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = AccentEmerald,
                                    contentColor = Color(0xFF042F22)
                                )
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.AddCircleOutline,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Report Incident", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(items = filteredPosts, key = { it.id }) { post ->
                        PostCard(
                            post = post,
                            isBusy = uiState.busyPostId == post.id,
                            busyActionType = if (uiState.busyPostId == post.id) uiState.busyActionType else null,
                            onVerify = { onVerify(post.id) },
                            onFlag = { onFlag(post.id) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PostCard(
    post: PostItem,
    isBusy: Boolean,
    busyActionType: String?,
    onVerify: () -> Unit,
    onFlag: () -> Unit
) {
    val resolvedImageUrl = remember(post.mediaUrl) { resolveMediaUrl(post.mediaUrl) }
    var imageFailed by remember(resolvedImageUrl) { mutableStateOf(false) }

    val advisoryMeta = advisoryVisuals(post.travelAdvisory)
    val verificationMeta = verificationVisuals(post.verificationStatus)
    val categoryColor = categoryColor(post.category)
    val severityColor = when {
        post.severity >= 7 -> AdvisoryDanger
        post.severity >= 4 -> AdvisoryCaution
        else -> AdvisorySafe
    }

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceCard),
        border = BorderStroke(1.dp, BorderSubtle),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            if (resolvedImageUrl != null && !imageFailed) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF050810))
                ) {
                    AsyncImage(
                        model = resolvedImageUrl,
                        contentDescription = post.title,
                        contentScale = ContentScale.Crop,
                        onError = { imageFailed = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 140.dp, max = 220.dp)
                    )
                    if (post.isLiveCaptured) {
                        Surface(
                            shape = CircleShape,
                            color = Color.Black.copy(alpha = 0.72f),
                            border = BorderStroke(1.dp, AccentEmerald.copy(alpha = 0.5f)),
                            modifier = Modifier
                                .align(Alignment.TopStart)
                                .padding(10.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(6.dp)
                                        .clip(CircleShape)
                                        .background(EmeraldLight)
                                )
                                Text(
                                    text = "LIVE PHOTO",
                                    color = EmeraldLight,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
            }

            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Badges row: Travel Advisory + Category + Verification Status
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    BadgeChip(
                        label = post.travelAdvisory,
                        color = advisoryMeta.color,
                        icon = advisoryMeta.icon
                    )
                    BadgeChip(
                        label = post.category,
                        color = categoryColor,
                        icon = null
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    BadgeChip(
                        label = post.verificationStatus,
                        color = verificationMeta.color,
                        icon = verificationMeta.icon
                    )
                }

                // Title + Translated Description
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = post.title,
                        color = TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        lineHeight = 21.sp
                    )
                    if (post.translatedDescription.isNotBlank()) {
                        Text(
                            text = post.translatedDescription,
                            color = Color(0xFFCBD5E1),
                            fontSize = 13.sp,
                            lineHeight = 19.sp
                        )
                    }
                }

                // Location Row
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.LocationOn,
                        contentDescription = null,
                        tint = AccentSky,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = post.locationName,
                        color = TextSecondary,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // Severity (1-10)
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Severity",
                            color = TextSecondary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = "${post.severity} / 10",
                            color = severityColor,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    LinearProgressIndicator(
                        progress = { (post.severity.coerceIn(0, 10) / 10f) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(999.dp)),
                        color = severityColor,
                        trackColor = BorderSubtle
                    )
                }

                HorizontalDivider(color = BorderSubtle)

                // Confirm & Flag Buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = onVerify,
                        enabled = !isBusy,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, AccentEmerald.copy(alpha = 0.45f)),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = AccentEmerald.copy(alpha = 0.12f),
                            contentColor = EmeraldLight
                        ),
                        contentPadding = PaddingValues(vertical = 10.dp, horizontal = 12.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        if (isBusy && busyActionType == "verify") {
                            CircularProgressIndicator(
                                modifier = Modifier.size(15.dp),
                                strokeWidth = 2.dp,
                                color = EmeraldLight
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Rounded.CheckCircle,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        val label = if (post.confirmations != null) {
                            "Confirm (${post.confirmations})"
                        } else {
                            "Confirm"
                        }
                        Text(text = label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }

                    OutlinedButton(
                        onClick = onFlag,
                        enabled = !isBusy,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, AdvisoryDanger.copy(alpha = 0.45f)),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = AdvisoryDanger.copy(alpha = 0.12f),
                            contentColor = Color(0xFFFCA5A5)
                        ),
                        contentPadding = PaddingValues(vertical = 10.dp, horizontal = 12.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        if (isBusy && busyActionType == "flag") {
                            CircularProgressIndicator(
                                modifier = Modifier.size(15.dp),
                                strokeWidth = 2.dp,
                                color = Color(0xFFFCA5A5)
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Rounded.Flag,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        val label = if (post.flags != null) {
                            "Flag (${post.flags})"
                        } else {
                            "Flag"
                        }
                        Text(text = label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun BadgeChip(
    label: String,
    color: Color,
    icon: ImageVector?
) {
    Surface(
        shape = CircleShape,
        color = color.copy(alpha = 0.16f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.42f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = color,
                    modifier = Modifier.size(12.dp)
                )
            }
            Text(
                text = label,
                color = color,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

private data class BadgeVisual(val color: Color, val icon: ImageVector)

private fun advisoryVisuals(advisory: String): BadgeVisual {
    return when (advisory.trim().lowercase(Locale.ROOT)) {
        "safe" -> BadgeVisual(AdvisorySafe, Icons.Rounded.Shield)
        "caution" -> BadgeVisual(AdvisoryCaution, Icons.Rounded.Warning)
        "danger" -> BadgeVisual(AdvisoryDanger, Icons.Rounded.Warning)
        else -> BadgeVisual(TextSecondary, Icons.Rounded.Warning)
    }
}

private fun verificationVisuals(status: String): BadgeVisual {
    val norm = status.trim().lowercase(Locale.ROOT)
    return when {
        norm.contains("verified") || norm.contains("confirm") ->
            BadgeVisual(AccentSky, Icons.Rounded.CheckCircle)
        norm.contains("flag") || norm.contains("disputed") ->
            BadgeVisual(AdvisoryDanger, Icons.Rounded.Flag)
        else ->
            BadgeVisual(TextSecondary, Icons.Rounded.Schedule)
    }
}

private fun categoryColor(category: String): Color {
    return when (category.trim().lowercase(Locale.ROOT)) {
        "disaster" -> Color(0xFFFB7185)
        "nature" -> Color(0xFF2DD4BF)
        "tourism" -> Color(0xFF818CF8)
        "road" -> Color(0xFFFB923C)
        else -> TextSecondary
    }
}
