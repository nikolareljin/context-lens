package com.contextlens.app.diagnostics

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** State of the on-device model, as the diagnostics screen shows it. */
sealed interface ModelState {
    data object Unknown : ModelState
    data object Checking : ModelState
    /** The phone cannot run the on-device model; the cloud tier still works. */
    data object Unavailable : ModelState
    data object Downloadable : ModelState
    /** [total] is null until the download reports its size. */
    data class Downloading(val done: Long, val total: Long?) : ModelState
    data object Available : ModelState
    data class Failed(val reason: String) : ModelState
}

/** Whole percent of a download, or null when the size is not known yet. */
fun downloadPercent(done: Long, total: Long?): Int? {
    if (total == null || total <= 0L) return null
    return ((done.coerceIn(0L, total) * 100) / total).toInt()
}

/** Short label for a model state, used in the report. */
fun ModelState.label(): String = when (this) {
    ModelState.Unknown -> "not checked"
    ModelState.Checking -> "checking"
    ModelState.Unavailable -> "unavailable on this device"
    ModelState.Downloadable -> "downloadable"
    is ModelState.Downloading -> downloadPercent(done, total)?.let { "downloading $it%" } ?: "downloading"
    ModelState.Available -> "available"
    is ModelState.Failed -> "error: $reason"
}

enum class Tier { ON_DEVICE, CLOUD }

/**
 * One model call made from the diagnostics screen. Only metadata is kept: the
 * test prompt is fixed and contains nothing personal, and replies are not stored.
 * Error text is passed through [redact].
 */
data class CallRecord(
    val atMillis: Long,
    val tier: Tier,
    val model: String,
    /** Where the reply was computed, as the SDK reports it (ON_DEVICE / IN_CLOUD); null on failure. */
    val source: String?,
    val latencyMs: Long,
    val outcome: String,
)

/** The most recent calls, newest first, bounded. */
class CallLog(private val capacity: Int = 50) {
    init {
        require(capacity > 0) { "capacity must be positive" }
    }

    private val _entries = MutableStateFlow<List<CallRecord>>(emptyList())
    val entries: StateFlow<List<CallRecord>> = _entries.asStateFlow()

    fun add(record: CallRecord) {
        _entries.update { (listOf(record) + it).take(capacity) }
    }
}

/**
 * Removes what an SDK error message may carry about the project: URLs (console
 * links) and long numbers (project numbers, app IDs).
 */
fun redact(text: String): String =
    text.replace(Regex("""https?://\S+"""), "<url>")
        .replace(Regex("""\d+(:\d+)*:(android|web|ios):[0-9a-f]+"""), "<app>")
        .replace(Regex("""\d{6,}"""), "<number>")

/** Facts for the copyable report. No account IDs, tokens or speech. */
data class ReportInfo(
    val appVersion: String,
    val device: String,
    val appCheck: String,
    val signIn: String,
    val model: ModelState,
    val onDeviceModelName: String?,
    val cloudModel: String?,
    val calls: List<CallRecord>,
)

fun buildReport(info: ReportInfo): String = buildString {
    appendLine("ContextLens diagnostics")
    appendLine("app: ${info.appVersion}")
    appendLine("device: ${info.device}")
    appendLine("app check: ${info.appCheck}")
    appendLine("sign-in: ${redact(info.signIn)}")
    appendLine("on-device model: ${info.model.label()}${info.onDeviceModelName?.let { " ($it)" } ?: ""}")
    appendLine("cloud model: ${info.cloudModel ?: "not tested"}")
    if (info.calls.isEmpty()) {
        append("calls: none")
    } else {
        appendLine("calls (newest first):")
        info.calls.forEachIndexed { i, c ->
            append("  ${c.tier} ${c.model} -> ${c.source ?: "-"}, ${c.latencyMs} ms, ${redact(c.outcome)}")
            if (i < info.calls.lastIndex) appendLine()
        }
    }
}
