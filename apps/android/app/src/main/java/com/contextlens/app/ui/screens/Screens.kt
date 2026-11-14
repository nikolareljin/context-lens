package com.contextlens.app.ui.screens

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.contextlens.app.BuildConfig
import com.contextlens.app.R
import com.contextlens.app.firebase.AppCheckProviders
import com.contextlens.app.firebase.AuthState
import com.contextlens.app.firebase.FirebaseSession

@Composable
private fun ScreenColumn(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        content()
    }
}

@Composable
private fun Row(label: String, value: String) {
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

@Composable
fun DiagnosticsScreen(session: FirebaseSession) {
    val auth by session.auth.collectAsState()
    ScreenColumn(stringResource(R.string.nav_diagnostics)) {
        Card {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(stringResource(R.string.diag_app_version), BuildConfig.VERSION_NAME)
                Row(stringResource(R.string.diag_device), "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                Row(stringResource(R.string.diag_app_check), AppCheckProviders.choice.label)
                Row(
                    stringResource(R.string.diag_auth),
                    when (val a = auth) {
                        AuthState.SigningIn -> stringResource(R.string.auth_signing_in)
                        is AuthState.SignedIn -> stringResource(if (a.anonymous) R.string.auth_anonymous else R.string.auth_signed_in)
                        is AuthState.Failed -> stringResource(R.string.auth_failed, a.reason)
                    },
                )
            }
        }
        Text(stringResource(R.string.diag_model_pending), style = MaterialTheme.typography.bodyMedium)
    }
}
