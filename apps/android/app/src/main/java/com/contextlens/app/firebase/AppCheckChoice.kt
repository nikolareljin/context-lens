package com.contextlens.app.firebase

/**
 * Which App Check provider a build installs.
 *
 * Debug builds use the debug provider (its token is registered in the Firebase console);
 * release builds use Play Integrity. The provider classes themselves live in the debug and
 * release source sets, so a release build does not contain the debug provider at all.
 */
enum class AppCheckChoice(val label: String) {
    DEBUG("Debug provider"),
    PLAY_INTEGRITY("Play Integrity");

    companion object {
        fun forBuild(debuggable: Boolean): AppCheckChoice = if (debuggable) DEBUG else PLAY_INTEGRITY
    }
}
