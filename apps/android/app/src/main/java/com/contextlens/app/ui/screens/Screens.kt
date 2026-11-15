package com.contextlens.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.contextlens.app.R

@Composable
internal fun ScreenColumn(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        content()
    }
}

@Composable
internal fun LabeledValue(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
fun ListenScreen() {
    ScreenColumn(stringResource(R.string.nav_listen)) {
        Text(stringResource(R.string.listen_empty), style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
fun LedgerScreen() {
    ScreenColumn(stringResource(R.string.ledger_title)) {
        Text(stringResource(R.string.ledger_empty), style = MaterialTheme.typography.bodyLarge)
    }
}
