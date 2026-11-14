package com.contextlens.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Tokens from the logo (docs/assets/logo.svg), shared with the documentation site.
// Cyan stands for work on the device, violet for the cloud, emerald for a verified claim.
val Slate950 = Color(0xFF0B1120)
val Slate900 = Color(0xFF0F172A)
val Slate800 = Color(0xFF1E293B)
val Slate700 = Color(0xFF334155)
val Slate400 = Color(0xFF94A3B8)
val Slate50 = Color(0xFFF8FAFC)
val Cyan = Color(0xFF38BDF8)
val CyanDeep = Color(0xFF0284C7)
val Indigo = Color(0xFF6366F1)
val IndigoDeep = Color(0xFF4F46E5)
val Violet = Color(0xFFA855F7)
val Emerald = Color(0xFF10B981)
val EmeraldLight = Color(0xFF34D399)

private val Light = lightColorScheme(
    primary = IndigoDeep,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E7FF),
    onPrimaryContainer = Color(0xFF1E1B4B),
    secondary = CyanDeep,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE0F2FE),
    onSecondaryContainer = Color(0xFF082F49),
    tertiary = Color(0xFF047857),
    onTertiary = Color.White,
    background = Slate50,
    onBackground = Slate900,
    surface = Color.White,
    onSurface = Slate900,
    surfaceVariant = Color(0xFFE2E8F0),
    onSurfaceVariant = Slate700,
    outline = Slate400,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Slate50,
    surfaceContainer = Color(0xFFF1F5F9),
    surfaceContainerHigh = Color(0xFFE9EEF5),
    surfaceContainerHighest = Color(0xFFE2E8F0),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF818CF8),
    onPrimary = Slate950,
    primaryContainer = Color(0xFF312E81),
    onPrimaryContainer = Color(0xFFE0E7FF),
    secondary = Cyan,
    onSecondary = Slate950,
    secondaryContainer = Color(0xFF0C4A6E),
    onSecondaryContainer = Color(0xFFE0F2FE),
    tertiary = EmeraldLight,
    onTertiary = Slate950,
    background = Slate900,
    onBackground = Color(0xFFE2E8F0),
    surface = Slate800,
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Slate700,
    onSurfaceVariant = Color(0xFFCBD5E1),
    outline = Color(0xFF475569),
    surfaceContainerLowest = Slate950,
    surfaceContainerLow = Slate900,
    surfaceContainer = Slate800,
    surfaceContainerHigh = Color(0xFF243247),
    surfaceContainerHighest = Slate700,
)

@Composable
fun ContextLensTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}
