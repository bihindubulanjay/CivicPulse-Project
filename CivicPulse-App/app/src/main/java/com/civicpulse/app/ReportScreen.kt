package com.civicpulse.app

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.GpsFixed
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportScreen(viewModel: MainViewModel, uiState: CivicPulseUiState) {
    val context = LocalContext.current
    var categoryExpanded by remember { mutableStateOf(false) }

    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        if (bitmap != null) {
            viewModel.onPhotoCaptured(bitmap)
        }
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            cameraLauncher.launch(null)
        } else {
            viewModel.showMessage("Camera permission denied")
        }
    }

    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) {
            viewModel.grabGpsLocation(context)
        } else {
            viewModel.applyFallbackGps("GPS permission denied — using Sri Lanka fallback (6.9271, 79.8612)")
        }
    }

    fun launchCamera() {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            cameraLauncher.launch(null)
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    fun requestGps() {
        val hasFine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (hasFine || hasCoarse) {
            viewModel.grabGpsLocation(context)
        } else {
            locationPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                )
            )
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgDeep)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = "Report Incident",
                color = TextPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Capture live photo evidence & GPS coordinates for the community feed.",
                color = TextSecondary,
                fontSize = 12.sp
            )
        }

        // GPS Coordinates Card
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceCard),
            border = BorderStroke(1.dp, BorderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "GPS COORDINATES",
                        color = TextSecondary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp
                    )
                    if (uiState.gpsState != null) {
                        Surface(
                            shape = CircleShape,
                            color = (if (uiState.gpsState.isFallback) AdvisoryCaution else AccentEmerald)
                                .copy(alpha = 0.16f),
                            border = BorderStroke(
                                1.dp,
                                (if (uiState.gpsState.isFallback) AdvisoryCaution else AccentEmerald)
                                    .copy(alpha = 0.45f)
                            )
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.CheckCircle,
                                    contentDescription = null,
                                    tint = if (uiState.gpsState.isFallback) AdvisoryCaution else EmeraldLight,
                                    modifier = Modifier.size(12.dp)
                                )
                                Text(
                                    text = uiState.gpsState.statusLabel,
                                    color = if (uiState.gpsState.isFallback) AdvisoryCaution else EmeraldLight,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    }
                }

                if (uiState.gpsState != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(SurfaceInput)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                text = "${uiState.gpsState.lat}, ${uiState.gpsState.lng}",
                                color = EmeraldLight,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = FontFamily.Monospace
                            )
                            Text(
                                text = "Populates lat, lng, user_lat, user_lng",
                                color = TextSecondary,
                                fontSize = 11.sp
                            )
                        }
                        OutlinedButton(
                            onClick = ::requestGps,
                            enabled = !uiState.isGrabbingGps,
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, BorderSubtle),
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                        ) {
                            if (uiState.isGrabbingGps) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(14.dp),
                                    strokeWidth = 2.dp,
                                    color = AccentSky
                                )
                            } else {
                                Icon(
                                    imageVector = Icons.Rounded.Refresh,
                                    contentDescription = null,
                                    tint = AccentSky,
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Refresh", color = TextPrimary, fontSize = 11.sp)
                        }
                    }
                } else {
                    OutlinedButton(
                        onClick = ::requestGps,
                        enabled = !uiState.isGrabbingGps,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, AccentSky.copy(alpha = 0.5f)),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = AccentSky.copy(alpha = 0.12f),
                            contentColor = AccentSky
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (uiState.isGrabbingGps) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = AccentSky
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Acquiring GPS...", fontWeight = FontWeight.SemiBold)
                        } else {
                            Icon(
                                imageVector = Icons.Rounded.GpsFixed,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Grab GPS Coordinates", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }

        // Live Camera Capture Card
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceCard),
            border = BorderStroke(1.dp, BorderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "LIVE CAMERA PHOTO",
                        color = TextSecondary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp
                    )
                    if (uiState.isLiveCaptured) {
                        Surface(
                            shape = CircleShape,
                            color = AccentEmerald.copy(alpha = 0.16f),
                            border = BorderStroke(1.dp, AccentEmerald.copy(alpha = 0.45f))
                        ) {
                            Text(
                                text = "LIVE CAPTURED",
                                color = EmeraldLight,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                            )
                        }
                    }
                }

                if (uiState.capturedBitmap != null) {
                    Image(
                        bitmap = uiState.capturedBitmap.asImageBitmap(),
                        contentDescription = "Captured live incident photo",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(190.dp)
                            .clip(RoundedCornerShape(12.dp))
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = ::launchCamera,
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, BorderSubtle),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.CameraAlt,
                                contentDescription = null,
                                tint = TextPrimary,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Retake", color = TextPrimary, fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = viewModel::clearPhoto,
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, AdvisoryDanger.copy(alpha = 0.45f)),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = AdvisoryDanger.copy(alpha = 0.12f),
                                contentColor = Color(0xFFFCA5A5)
                            ),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.DeleteOutline,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Remove", fontSize = 12.sp)
                        }
                    }
                } else {
                    OutlinedButton(
                        onClick = ::launchCamera,
                        enabled = !uiState.isEncodingPhoto,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, AccentEmerald.copy(alpha = 0.5f)),
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = AccentEmerald.copy(alpha = 0.10f),
                            contentColor = EmeraldLight
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                    ) {
                        if (uiState.isEncodingPhoto) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = EmeraldLight
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Encoding JPEG...", fontWeight = FontWeight.SemiBold)
                        } else {
                            Icon(
                                imageVector = Icons.Rounded.CameraAlt,
                                contentDescription = null,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Capture Live Photo", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }

        // Incident Form Fields
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceCard),
            border = BorderStroke(1.dp, BorderSubtle),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedTextField(
                    value = uiState.reportTitle,
                    onValueChange = viewModel::updateReportTitle,
                    label = { Text("Title") },
                    placeholder = { Text("e.g. Flash flooding blocking Kelani Bridge") },
                    singleLine = true,
                    colors = civicTextFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                ExposedDropdownMenuBox(
                    expanded = categoryExpanded,
                    onExpandedChange = { categoryExpanded = !categoryExpanded }
                ) {
                    OutlinedTextField(
                        value = uiState.reportCategory,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Category") },
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = categoryExpanded)
                        },
                        colors = civicTextFieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                            .fillMaxWidth()
                    )

                    ExposedDropdownMenu(
                        expanded = categoryExpanded,
                        onDismissRequest = { categoryExpanded = false },
                        containerColor = SurfaceCard
                    ) {
                        INCIDENT_CATEGORIES.forEach { category ->
                            DropdownMenuItem(
                                text = { Text(text = category, color = TextPrimary) },
                                onClick = {
                                    viewModel.updateReportCategory(category)
                                    categoryExpanded = false
                                }
                            )
                        }
                    }
                }

                OutlinedTextField(
                    value = uiState.reportLocationName,
                    onValueChange = viewModel::updateReportLocationName,
                    label = { Text("Location Name") },
                    placeholder = { Text("e.g. Colombo Fort / Galle Road Mile 4") },
                    singleLine = true,
                    colors = civicTextFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = uiState.reportDescription,
                    onValueChange = viewModel::updateReportDescription,
                    label = { Text("Description") },
                    placeholder = { Text("Describe hazards, road status, or safety advice...") },
                    minLines = 4,
                    maxLines = 6,
                    colors = civicTextFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        if (!uiState.reportError.isNullOrBlank()) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = AdvisoryDanger.copy(alpha = 0.14f),
                border = BorderStroke(1.dp, AdvisoryDanger.copy(alpha = 0.45f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.ErrorOutline,
                        contentDescription = null,
                        tint = AdvisoryDanger,
                        modifier = Modifier.size(18.dp)
                    )
                    Text(
                        text = uiState.reportError,
                        color = Color(0xFFFECACA),
                        fontSize = 12.sp
                    )
                }
            }
        }

        Button(
            onClick = viewModel::submitReport,
            enabled = !uiState.isSubmittingReport && !uiState.isEncodingPhoto,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = AccentEmerald,
                contentColor = Color(0xFF042F22)
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            if (uiState.isSubmittingReport) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.5.dp,
                    color = Color(0xFF042F22)
                )
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = "Publishing Report...",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )
            } else {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.Send,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Publish Safety Report",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        Spacer(modifier = Modifier.height(6.dp))
    }
}

@Composable
private fun civicTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = AccentEmerald,
    unfocusedBorderColor = BorderSubtle,
    focusedContainerColor = SurfaceInput,
    unfocusedContainerColor = SurfaceInput,
    focusedTextColor = TextPrimary,
    unfocusedTextColor = TextPrimary,
    focusedLabelColor = EmeraldLight,
    unfocusedLabelColor = TextSecondary,
    focusedPlaceholderColor = TextMuted,
    unfocusedPlaceholderColor = TextMuted,
    cursorColor = AccentEmerald
)
