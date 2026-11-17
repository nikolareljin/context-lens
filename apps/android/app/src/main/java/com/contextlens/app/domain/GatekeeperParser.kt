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
 * that is not valid (no kind and no claim flag, an unknown kind, or a claim without
 * a query) gives null, and nothing is sent. Prompt v2 replies name the kind of
 * sentence instead of a claim flag; when both are present, the kind decides.
 */
object GatekeeperParser {
    const val QUERY_MAX = 240
    const val REFS_MAX = 5
    const val REF_MAX = 80

    fun parse(text: String?): GatekeeperResult? {
        if (text == null) return null
        val block = firstObject(text) ?: return null
        val obj = runCatching { Json.parseToJsonElement(block) }.getOrNull() as? JsonObject ?: return null
        val kind = kindOf(obj.string("kind"))
        if (kind == UNKNOWN_KIND) return null
        val claim = kind?.let { it == "world" } ?: obj.flag("claim", "hasVerifiableClaim") ?: return null
        val query = obj.string("query", "sanitizedResolvedQuery").oneLine()
        if (claim && query.isEmpty()) return null
        val refs = (obj["refs"] ?: obj["resolvedReferences"]).let { it as? JsonArray }.orEmpty()
            .mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.oneLine()?.take(REF_MAX) }
            .filter { it.isNotEmpty() }
            .take(REFS_MAX)
        val reason = listOf(obj.string("reason"), obj.string("filterReason"), kind.orEmpty())
            .map { it.oneLine() }.firstOrNull { it.isNotEmpty() }
        return GatekeeperResult(
            hasVerifiableClaim = claim,
            sanitizedResolvedQuery = if (claim) query.take(QUERY_MAX) else "",
            resolvedReferences = if (claim) refs else emptyList(),
            filterReason = if (claim) null else reason,
        )
    }

    /** The first balanced {...} block, skipping braces inside strings. */
    internal fun firstObject(text: String): String? {
        val start = text.indexOf('{')
        if (start < 0) return null
        var depth = 0
        var inString = false
        var escaped = false
        for (i in start until text.length) {
            val c = text[i]
            when {
                escaped -> escaped = false
                inString && c == '\\' -> escaped = true
                c == '"' -> inString = !inString
                inString -> {}
                c == '{' -> depth++
                c == '}' -> if (--depth == 0) return text.substring(start, i + 1)
            }
        }
        return null
    }

    private val KINDS = setOf("world", "small talk", "request", "opinion", "personal")
    private const val UNKNOWN_KIND = "?"

    /**
     * The kind in a v2 reply, normalized: case, spaces, quotes and trailing punctuation are
     * ignored, and "world fact" counts as world. null when there is no kind (a v1 reply);
     * UNKNOWN_KIND for anything else, such as the template's own list echoed back.
     */
    private fun kindOf(raw: String): String? {
        val k = raw.lowercase().trim().trim('"', '\'', '.', '!', ' ').replace(Regex("\\s+"), " ")
        if (k.isEmpty()) return null
        if (k in KINDS) return k
        return if (k.startsWith("world ") && ',' !in k) "world" else UNKNOWN_KIND
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
