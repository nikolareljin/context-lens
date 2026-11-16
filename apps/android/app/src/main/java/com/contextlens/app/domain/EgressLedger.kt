package com.contextlens.app.domain

import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class EgressKind {
    /** The sentence and its context (Balanced mode, when the model ran in the cloud). */
    RAW_TEXT,

    /** Only the clean question, sent to the grounded verifier. */
    CLEAN_QUERY,
}

/** One request that left the phone, with the exact text that was sent. */
data class EgressEntry(
    val atMillis: Long,
    val kind: EgressKind,
    val stage: String,
    val model: String,
    val text: String,
    val bytes: Int,
    /** inferenceSource as reported; null when the call failed before a reply. */
    val source: String?,
    val latencyMs: Long,
    val promptVersion: String,
    val outcome: String,
)

/**
 * Every outbound AI request, in memory only, newest first. The privacy counters
 * are computed from it, so "raw text sent: 0 B" is a measurement.
 */
class EgressLedger(private val capacity: Int = 200) {
    private val _entries = MutableStateFlow<List<EgressEntry>>(emptyList())
    val entries: StateFlow<List<EgressEntry>> = _entries.asStateFlow()

    fun add(entry: EgressEntry) = _entries.update { (listOf(entry) + it).take(capacity) }

    fun clear() {
        _entries.value = emptyList()
    }

    fun export(): String = buildString {
        appendLine("ContextLens egress ledger (${_entries.value.size} requests)")
        _entries.value.asReversed().forEach { e ->
            appendLine()
            appendLine("${Instant.ofEpochMilli(e.atMillis)} ${e.stage} ${e.kind} ${e.model} prompt ${e.promptVersion}")
            appendLine("source ${e.source ?: "none"} · ${e.latencyMs} ms · ${e.bytes} B · ${e.outcome}")
            appendLine(e.text)
        }
    }

    companion object {
        fun bytesOf(text: String): Int = text.toByteArray(Charsets.UTF_8).size
    }
}

data class EgressTotals(val rawBytes: Int, val cleanBytes: Int, val cloudChecks: Int)

fun List<EgressEntry>.totals(): EgressTotals = EgressTotals(
    rawBytes = filter { it.kind == EgressKind.RAW_TEXT }.sumOf { it.bytes },
    cleanBytes = filter { it.kind == EgressKind.CLEAN_QUERY }.sumOf { it.bytes },
    cloudChecks = count { it.kind == EgressKind.CLEAN_QUERY && it.source != null },
)
