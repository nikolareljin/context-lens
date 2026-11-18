package com.contextlens.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.contextlens.app.firebase.CloudProjects
import com.contextlens.app.firebase.ConnectRequest
import com.contextlens.app.ui.AppNav
import com.contextlens.app.ui.theme.ContextLensTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as ContextLensApp
        // A link opened after a restart is handled again only on a fresh start, not on recreation.
        if (savedInstanceState == null) handleConnectLink(intent)
        setContent {
            ContextLensTheme {
                AppNav(
                    session = app.session,
                    models = app.models,
                    sessionContext = app.sessionContext,
                    pipeline = app.pipeline,
                    demo = app.demo,
                    cloud = app.cloud,
                    cloudStore = app.cloudStore,
                    connectRequests = app.connectRequests,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleConnectLink(intent)
    }

    /** contextlens://connect?project=…&app=…&key=… fills in Settings; the user still has to save. */
    private fun handleConnectLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        if (uri.scheme != CloudProjects.CONNECT_SCHEME || uri.host != CloudProjects.CONNECT_HOST) return
        val params = runCatching {
            uri.queryParameterNames.associateWith { uri.getQueryParameter(it).orEmpty() }
        }.getOrDefault(emptyMap())
        val project = CloudProjects.fromConnectParams(params)
        (application as ContextLensApp).connectRequests.offer(
            if (project != null) ConnectRequest.Valid(project) else ConnectRequest.Invalid,
        )
        // The values are not kept in the activity's intent once read.
        setIntent(Intent(this, MainActivity::class.java))
    }
}
