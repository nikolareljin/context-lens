package com.contextlens.app.domain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Reads the gatekeeper's JSON reply. The on-device model may wrap it in a code
 * fence or add a sentence around it, so the first {...} block is taken. A reply
 * that is not valid (no claim flag, or a claim without a query) gives null, and
 * nothing is sent.
 */
object GatekeeperParser {
    const val QUERY_MAX = 240
    const val REFS_MAX = 5
    const val REF_MAX = 80

    fun parse(text: String?): GatekeeperResult? {
        if (text == null) return null
        val start = text.indexOf('{')
        val end = text.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        val obj = runCatching { Json.parseToJsonElement(text.substring(start, end + 1)) }.getOrNull() as? JsonObject
            ?: return null
        val claim = obj.flag("claim", "hasVerifiableClaim") ?: return null
        val query = obj.string("query", "sanitizedResolvedQuery").oneLine()
        if (claim && query.isEmpty()) return null
        val refs = (obj["refs"] ?: obj["resolvedReferences"]).let { it as? JsonArray }.orEmpty()
            .mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.oneLine()?.take(REF_MAX) }
            .filter { it.isNotEmpty() }
            .take(REFS_MAX)
        val reason = obj.string("reason", "filterReason").oneLine().ifEmpty { null }
        return GatekeeperResult(
            hasVerifiableClaim = claim,
            sanitizedResolvedQuery = if (claim) query.take(QUERY_MAX) else "",
            resolvedReferences = if (claim) refs else emptyList(),
            filterReason = if (claim) null else reason,
        )
    }

    private fun JsonObject.field(vararg keys: String): JsonElement? = keys.firstNotNullOfOrNull { this[it] }

    private fun JsonObject.flag(vararg keys: String): Boolean? {
        val p = field(*keys) as? JsonPrimitive ?: return null
        return p.booleanOrNull ?: when (p.contentOrNull?.trim()?.lowercase()) {
            "true", "yes" -> true
            "false", "no" -> false
            else -> null
        }
    }

    private fun JsonObject.string(vararg keys: String): String =
        (field(*keys) as? JsonPrimitive)?.contentOrNull.orEmpty()

    private fun String.oneLine(): String = trim().replace(Regex("\\s+"), " ")
}
