package com.contextlens.app.firebase

import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

/** Anonymous sign-in state, shown on the diagnostics screen. */
sealed interface AuthState {
    data object SigningIn : AuthState
    data class SignedIn(val anonymous: Boolean) : AuthState
    data class Failed(val reason: String) : AuthState
}

/**
 * Signs the install in anonymously so App Check and per-install limits work.
 * No name, email or contact data is requested.
 */
class FirebaseSession {
    private val _auth = MutableStateFlow<AuthState>(AuthState.SigningIn)
    val auth: StateFlow<AuthState> = _auth.asStateFlow()

    suspend fun ensureSignedIn() {
        val current = Firebase.auth.currentUser
        if (current != null) {
            _auth.value = AuthState.SignedIn(current.isAnonymous)
            return
        }
        _auth.value = AuthState.SigningIn
        _auth.value = try {
            val user = Firebase.auth.signInAnonymously().await().user
            if (user != null) AuthState.SignedIn(user.isAnonymous) else AuthState.Failed("no user returned")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            AuthState.Failed(e.message ?: e.javaClass.simpleName)
        }
    }
}
