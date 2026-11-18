package com.contextlens.app.firebase

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What a connect link asked for, in memory only: Settings shows it until the user saves or leaves. */
sealed interface ConnectRequest {
    data class Valid(val project: CloudProject) : ConnectRequest
    /** The link was opened but its values are missing or malformed. */
    data object Invalid : ConnectRequest
}

class ConnectRequests {
    private val _pending = MutableStateFlow<ConnectRequest?>(null)
    val pending: StateFlow<ConnectRequest?> = _pending.asStateFlow()

    fun offer(request: ConnectRequest) {
        _pending.value = request
    }

    fun consume(): ConnectRequest? = _pending.value.also { _pending.value = null }
}
