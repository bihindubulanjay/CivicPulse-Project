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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SmartToy
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val QUICK_PROMPTS = listOf(
    "Nearby safety alerts?",
    "Flood evacuation steps",
    "Road closure alternatives"
)

@Composable
fun AiChatScreen(viewModel: MainViewModel, uiState: CivicPulseUiState) {
    var inputText by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(uiState.chatMessages.size, uiState.isChatSending) {
        val total = uiState.chatMessages.size + if (uiState.isChatSending) 1 else 0
        if (total > 0) {
            listState.animateScrollToItem(total - 1)
        }
    }

    fun sendCurrent() {
        val trimmed = inputText.trim()
        if (trimmed.isNotEmpty() && !uiState.isChatSending) {
            inputText = ""
            viewModel.sendChatMessage(trimmed)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDeep)
            .imePadding()
    ) {
        // Chat sub-header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(SurfaceNav)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(AccentEmerald.copy(alpha = 0.18f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Rounded.SmartToy,
                        contentDescription = null,
                        tint = EmeraldLight,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Column {
                    Text(
                        text = "CivicPulse AI Safety",
                        color = TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Row(
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
                            text = "Gemini Safety Assistant",
                            color = EmeraldLight,
                            fontSize = 11.sp
                        )
                    }
                }
            }

            Surface(
                shape = RoundedCornerShape(8.dp),
                color = SurfaceCard,
                border = BorderStroke(1.dp, BorderSubtle),
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(enabled = !uiState.isChatSending, onClick = viewModel::resetChat)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Refresh,
                        contentDescription = "Reset chat",
                        tint = TextSecondary,
                        modifier = Modifier.size(14.dp)
                    )
                    Text(
                        text = "Reset",
                        color = TextSecondary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        HorizontalDivider(color = BorderSubtle)

        // Messages list
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(items = uiState.chatMessages, key = { it.id }) { msg ->
                ChatBubble(message = msg)
            }

            if (uiState.chatMessages.size == 1 && !uiState.isChatSending) {
                item(key = "quick_prompts") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(top = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        QUICK_PROMPTS.forEach { prompt ->
                            Surface(
                                shape = CircleShape,
                                color = SurfaceCard,
                                border = BorderStroke(1.dp, AccentEmerald.copy(alpha = 0.4f)),
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .clickable { viewModel.sendChatMessage(prompt) }
                            ) {
                                Text(
                                    text = prompt,
                                    color = EmeraldLight,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                                )
                            }
                        }
                    }
                }
            }

            if (uiState.isChatSending) {
                item(key = "ai_typing") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Start
                    ) {
                        Surface(
                            shape = RoundedCornerShape(
                                topStart = 16.dp,
                                topEnd = 16.dp,
                                bottomEnd = 16.dp,
                                bottomStart = 4.dp
                            ),
                            color = SurfaceCard,
                            border = BorderStroke(1.dp, BorderSubtle)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(14.dp),
                                    strokeWidth = 2.dp,
                                    color = AccentEmerald
                                )
                                Text(
                                    text = "Gemini is analyzing safety context...",
                                    color = TextSecondary,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    }
                }
            }
        }

        HorizontalDivider(color = BorderSubtle)

        // Sticky composer bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(SurfaceNav)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = inputText,
                onValueChange = { inputText = it },
                placeholder = { Text("Ask about hazards, routes, safety...") },
                maxLines = 3,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { sendCurrent() }),
                shape = RoundedCornerShape(24.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = AccentEmerald,
                    unfocusedBorderColor = BorderSubtle,
                    focusedContainerColor = SurfaceInput,
                    unfocusedContainerColor = SurfaceInput,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedPlaceholderColor = TextMuted,
                    unfocusedPlaceholderColor = TextMuted,
                    cursorColor = AccentEmerald
                ),
                modifier = Modifier.weight(1f)
            )

            IconButton(
                onClick = ::sendCurrent,
                enabled = inputText.isNotBlank() && !uiState.isChatSending,
                colors = IconButtonDefaults.iconButtonColors(
                    containerColor = AccentEmerald,
                    contentColor = Color(0xFF042F22),
                    disabledContainerColor = SurfaceCard,
                    disabledContentColor = TextMuted
                ),
                modifier = Modifier.size(46.dp)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.Send,
                    contentDescription = "Send message",
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
private fun ChatBubble(message: ChatMessage) {
    val alignment = if (message.isUser) Alignment.End else Alignment.Start
    val bubbleColor = when {
        message.isUser -> Color(0xFF065F46)
        message.isError -> AdvisoryDanger.copy(alpha = 0.16f)
        else -> SurfaceCard
    }
    val borderColor = when {
        message.isUser -> AccentEmerald.copy(alpha = 0.45f)
        message.isError -> AdvisoryDanger.copy(alpha = 0.45f)
        else -> BorderSubtle
    }
    val shape = if (message.isUser) {
        RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 4.dp)
    } else {
        RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 4.dp)
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = alignment
    ) {
        Surface(
            shape = shape,
            color = bubbleColor,
            border = BorderStroke(1.dp, borderColor),
            modifier = Modifier.widthIn(max = 310.dp)
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 13.dp, vertical = 9.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = message.text,
                    color = if (message.isError) Color(0xFFFECACA) else TextPrimary,
                    fontSize = 13.sp,
                    lineHeight = 19.sp
                )
                Text(
                    text = message.timestamp,
                    color = if (message.isUser) Color(0xFFA7F3D0) else TextMuted,
                    fontSize = 10.sp,
                    modifier = Modifier.align(Alignment.End)
                )
            }
        }
    }
}
