package com.civicpulse.app

import android.graphics.Color as AndroidColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddCircleOutline
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Login
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT)
        )
        setContent {
            CivicPulseTheme {
                CivicPulseApp()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CivicPulseApp(viewModel: MainViewModel = viewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.snackbarMessage) {
        val message = uiState.snackbarMessage
        if (!message.isNullOrBlank()) {
            snackbarHostState.showSnackbar(message)
            viewModel.consumeSnackbar()
        }
    }

    Scaffold(
        containerColor = BgDeep,
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState) { data ->
                Snackbar(
                    snackbarData = data,
                    containerColor = SurfaceCard,
                    contentColor = TextPrimary,
                    actionColor = EmeraldLight
                )
            }
        },
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SurfaceNav,
                    titleContentColor = TextPrimary
                ),
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(AccentEmerald.copy(alpha = 0.16f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Shield,
                                contentDescription = null,
                                tint = EmeraldLight,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                        Column {
                            Text(
                                text = "CivicPulse",
                                color = TextPrimary,
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "LIVE SAFETY",
                                color = EmeraldLight,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = 1.sp
                            )
                        }
                    }
                },
                actions = {
                    DemoLoginPill(
                        isAuthenticated = !uiState.authToken.isNullOrBlank(),
                        isLoggingIn = uiState.isLoggingIn,
                        onClick = viewModel::triggerDemoLogin,
                        modifier = Modifier.padding(end = 12.dp)
                    )
                }
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = SurfaceNav,
                tonalElevation = 0.dp
            ) {
                AppTab.entries.forEach { tab ->
                    val icon = when (tab) {
                        AppTab.FEED -> Icons.Rounded.Public
                        AppTab.REPORT -> Icons.Rounded.AddCircleOutline
                        AppTab.CHAT -> Icons.Rounded.ChatBubbleOutline
                    }
                    NavigationBarItem(
                        selected = uiState.activeTab == tab,
                        onClick = { viewModel.selectTab(tab) },
                        icon = {
                            Icon(
                                imageVector = icon,
                                contentDescription = tab.label
                            )
                        },
                        label = {
                            Text(
                                text = tab.label,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = EmeraldLight,
                            selectedTextColor = EmeraldLight,
                            indicatorColor = AccentEmerald.copy(alpha = 0.16f),
                            unselectedIconColor = TextSecondary,
                            unselectedTextColor = TextSecondary
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
        ) {
            when (uiState.activeTab) {
                AppTab.FEED -> LiveFeedScreen(
                    uiState = uiState,
                    onRefresh = viewModel::loadFeed,
                    onSelectFilter = viewModel::selectCategoryFilter,
                    onVerify = viewModel::verifyPost,
                    onFlag = viewModel::flagPost,
                    onGoToReport = { viewModel.selectTab(AppTab.REPORT) }
                )

                AppTab.REPORT -> ReportScreen(
                    viewModel = viewModel,
                    uiState = uiState
                )

                AppTab.CHAT -> AiChatScreen(
                    viewModel = viewModel,
                    uiState = uiState
                )
            }
        }
    }
}

@Composable
private fun DemoLoginPill(
    isAuthenticated: Boolean,
    isLoggingIn: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val accent = if (isAuthenticated) AccentEmerald else AdvisoryCaution
    Surface(
        shape = CircleShape,
        color = accent.copy(alpha = 0.15f),
        border = BorderStroke(1.dp, accent.copy(alpha = 0.45f)),
        modifier = modifier
            .clip(CircleShape)
            .clickable(enabled = !isLoggingIn, onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            when {
                isLoggingIn -> {
                    CircularProgressIndicator(
                        modifier = Modifier.size(13.dp),
                        strokeWidth = 2.dp,
                        color = accent
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Signing in...",
                        color = accent,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                isAuthenticated -> {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(EmeraldLight)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Demo Active",
                        color = EmeraldLight,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                else -> {
                    Icon(
                        imageVector = Icons.Rounded.Login,
                        contentDescription = null,
                        tint = AdvisoryCaution,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(
                        text = "Demo Login",
                        color = AdvisoryCaution,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}
