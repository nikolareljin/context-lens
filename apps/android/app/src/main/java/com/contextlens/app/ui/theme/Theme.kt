package com.contextlens.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Tokens shared with the documentation site.
val Navy = Color(0xFF1B2A41)
val NavyDeep = Color(0xFF111B2B)
val Amber = Color(0xFFFFA000)
val Yellow = Color(0xFFFFCA28)
val Orange = Color(0xFFF57C00)
val Blue = Color(0xFF1A73E8)
val BlueLight = Color(0xFF8AB4F8)

private val Light = lightColorScheme(
    primary = Navy,
    onPrimary = Color.White,
    secondary = Orange,
    onSecondary = Color.White,
    tertiary = Blue,
    onTertiary = Color.White,
    primaryContainer = Color(0xFFDDE3EC),
    onPrimaryContainer = Navy,
    secondaryContainer = Color(0xFFFFE0B2),
    onSecondaryContainer = Color(0xFF4A2800),
    background = Color(0xFFF8F9FB),
    surface = Color.White,
)

private val Dark = darkColorScheme(
    primary = Yellow,
    onPrimary = NavyDeep,
    secondary = Amber,
    onSecondary = NavyDeep,
    tertiary = BlueLight,
    onTertiary = NavyDeep,
    primaryContainer = Color(0xFF2A3B55),
    onPrimaryContainer = Color(0xFFE3E8F0),
    secondaryContainer = Color(0xFF5A3A00),
    onSecondaryContainer = Color(0xFFFFE0B2),
    background = NavyDeep,
    surface = Navy,
)

@Composable
fun ContextLensTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}
