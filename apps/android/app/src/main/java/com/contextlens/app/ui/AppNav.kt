package com.contextlens.app.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.contextlens.app.R
import com.contextlens.app.ai.ModelGateway
import com.contextlens.app.context.SessionContextManager
import com.contextlens.app.domain.HybridContextPipeline
import com.contextlens.app.firebase.FirebaseSession
import com.contextlens.app.ui.screens.DiagnosticsScreen
import com.contextlens.app.ui.screens.LedgerScreen
import com.contextlens.app.ui.screens.ListenScreen

enum class Destination(val route: String, @StringRes val label: Int, val icon: ImageVector) {
    LISTEN("listen", R.string.nav_listen, Icons.Filled.PlayArrow),
    LEDGER("ledger", R.string.nav_ledger, Icons.AutoMirrored.Filled.List),
    DIAGNOSTICS("diagnostics", R.string.nav_diagnostics, Icons.Filled.Info),
}

@Composable
fun AppNav(
    session: FirebaseSession,
    models: ModelGateway,
    sessionContext: SessionContextManager,
    pipeline: HybridContextPipeline,
) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    Scaffold(
        bottomBar = {
            NavigationBar {
                Destination.entries.forEach { dest ->
                    NavigationBarItem(
                        selected = current == dest.route,
                        onClick = {
                            nav.navigate(dest.route) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(dest.icon, contentDescription = null) },
                        label = { Text(stringResource(dest.label)) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = Destination.LISTEN.route, modifier = Modifier.padding(padding)) {
            composable(Destination.LISTEN.route) { ListenScreen(sessionContext, pipeline) }
            composable(Destination.LEDGER.route) { LedgerScreen(pipeline) }
            composable(Destination.DIAGNOSTICS.route) { DiagnosticsScreen(session, models) }
        }
    }
}
