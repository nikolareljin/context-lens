package com.contextlens.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.contextlens.app.ui.AppNav
import com.contextlens.app.ui.theme.ContextLensTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as ContextLensApp
        setContent {
            ContextLensTheme {
                AppNav(
                    session = app.session,
                    models = app.models,
                    sessionContext = app.sessionContext,
                    pipeline = app.pipeline,
                )
            }
        }
    }
}
