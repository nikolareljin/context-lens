package com.contextlens.app.domain

/**
 * How the gatekeeper runs. Strict keeps raw speech on the phone: without the
 * on-device model nothing is checked. Balanced lets Firebase AI Logic fall back to
 * cloud Gemini when the phone can't run the model, which sends the sentence and
 * its context; the ledger records that as raw text sent.
 */
enum class PrivacyMode { STRICT, BALANCED }

enum class Verdict { VERIFIED, NUANCED, FALSE, INSUFFICIENT_EVIDENCE }

/** One web source from the grounding metadata. */
data class Citation(val title: String, val uri: String, val domain: String)

/** What Google Search grounding returned with a reply. */
data class Grounding(
    val citations: List<Citation>,
    val searchQueries: List<String>,
    /** Google's Search Suggestions chip (HTML), to be shown with grounded results. */
    val searchEntryPointHtml: String?,
)

/** The gatekeeper's answer, after validation. */
data class GatekeeperResult(
    val hasVerifiableClaim: Boolean,
    /** Self-contained, without personal data; empty when there is no claim. */
    val sanitizedResolvedQuery: String,
    /** e.g. "here -> Springfield". */
    val resolvedReferences: List<String>,
    val filterReason: String?,
)

/** A verdict as shown: the deterministic rules have the last word over the model. */
data class FactCard(
    val verdict: Verdict,
    /** What the model said before the rules ran; null when it gave no readable verdict. */
    val modelVerdict: Verdict?,
    /** At most two sentences. */
    val summary: String,
    val grounding: Grounding,
    val model: String,
    /** As Firebase AI Logic reported it, e.g. IN_CLOUD. */
    val source: String?,
    val latencyMs: Long,
)

/** A model reply reduced to what the pipeline uses. */
data class ModelReply(
    val text: String?,
    /** response.inferenceSource, verbatim (ON_DEVICE or IN_CLOUD). */
    val source: String?,
    val grounding: Grounding? = null,
)

/** One model behind Firebase AI Logic; faked in tests. */
interface TextModel {
    val name: String
    suspend fun generate(prompt: String): ModelReply
}

/** A versioned prompt template; the version goes into every ledger entry. */
data class Prompt(val version: String, val template: String) {
    fun fill(values: Map<String, String>): String =
        values.entries.fold(template) { acc, (key, value) -> acc.replace("{{$key}}", value) }
}
