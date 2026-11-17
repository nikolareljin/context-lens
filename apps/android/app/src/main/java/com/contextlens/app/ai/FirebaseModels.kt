@file:OptIn(PublicPreviewAPI::class)

package com.contextlens.app.ai

import android.content.res.AssetManager
import com.contextlens.app.domain.Grounding
import com.contextlens.app.domain.GroundingParser
import com.contextlens.app.domain.ModelReply
import com.contextlens.app.domain.ModelSource
import com.contextlens.app.domain.PipelinePrompts
import com.contextlens.app.domain.PrivacyMode
import com.contextlens.app.domain.Prompt
import com.contextlens.app.domain.TextModel
import com.contextlens.app.domain.WebSource
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.type.GenerateContentResponse
import com.google.firebase.ai.type.GenerationConfig
import com.google.firebase.ai.type.GroundingMetadata
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.ThinkingConfig
import com.google.firebase.ai.type.ThinkingLevel
import com.google.firebase.ai.type.Tool

/**
 * Grounded verifier models, in the order tried until Remote Config provides one.
 * Measured on Nov 15: gemini-3.1-flash-lite answers in under a second;
 * gemini-3.8-flash did not answer a probe within 20 s with default thinking, so it
 * runs with a low thinking level and is the fallback.
 */
val VERIFIER_CANDIDATES = listOf("gemini-3.1-flash-lite", "gemini-3.8-flash")

/** The cloud model behind the gatekeeper in Balanced mode, used only when the phone can't run it. */
const val GATEKEEPER_FALLBACK_MODEL = "gemini-3.1-flash-lite"

/** A Firebase AI Logic model as the pipeline sees it. */
class FirebaseTextModel(override val name: String, private val build: () -> GenerativeModel) : TextModel {
    private val model by lazy(build)

    override suspend fun generate(prompt: String): ModelReply = model.generateContent(prompt).toReply()
}

internal fun GenerateContentResponse.toReply(): ModelReply = ModelReply(
    text = text,
    source = inferenceSource.label(),
    grounding = candidates.firstOrNull()?.groundingMetadata?.toGrounding(),
)

/** A stable name for the source: the SDK's own toString() reads "On Device" / "In Cloud". */
internal fun InferenceSource.label(): String = when (this) {
    InferenceSource.ON_DEVICE -> "ON_DEVICE"
    InferenceSource.IN_CLOUD -> "IN_CLOUD"
    else -> toString()
}

/** The grounding metadata as plain data, for [GroundingParser]. */
internal fun GroundingMetadata.toGrounding(): Grounding = GroundingParser.parse(
    sources = groundingChunks.mapNotNull { it.web }.map { WebSource(it.uri, it.title, it.domain) },
    searchQueries = webSearchQueries,
    searchEntryPointHtml = searchEntryPoint?.renderedContent,
)

/** The pipeline's models: the gatekeeper per privacy mode and the grounded verifiers. */
class FirebaseModelSource(private val gateway: ModelGateway) : ModelSource {
    private val gatekeepers = mapOf(
        PrivacyMode.STRICT to gatekeeper(InferenceMode.ONLY_ON_DEVICE),
        PrivacyMode.BALANCED to gatekeeper(InferenceMode.PREFER_ON_DEVICE),
    )

    private val verifiers = VERIFIER_CANDIDATES.associateWith { name ->
        FirebaseTextModel(name) {
            gateway.build(
                name = name,
                onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
                generationConfig = verifierConfig(lowThinking = !name.contains("lite")),
                tools = listOf(Tool.googleSearch()),
            )
        }
    }

    @Volatile private var preferred: String? = null

    private fun gatekeeper(mode: InferenceMode) = FirebaseTextModel(GATEKEEPER_FALLBACK_MODEL) {
        gateway.build(
            name = GATEKEEPER_FALLBACK_MODEL,
            onDeviceConfig = OnDeviceConfig(mode = mode, maxOutputTokens = 256, temperature = 0.1f),
            generationConfig = GenerationConfig.builder().setMaxOutputTokens(256).build(),
        )
    }

    /** Short answers only: two sentences and a verdict. Thinking tokens count toward the limit, hence the margin. */
    private fun verifierConfig(lowThinking: Boolean): GenerationConfig {
        val builder = GenerationConfig.builder().setMaxOutputTokens(1024)
        if (lowThinking) builder.setThinkingConfig(ThinkingConfig.Builder().setThinkingLevel(ThinkingLevel.LOW).build())
        return builder.build()
    }

    override fun gatekeeper(mode: PrivacyMode): TextModel = gatekeepers.getValue(mode)

    override fun verifiers(): List<TextModel> {
        val first = preferred
        return verifiers.values.sortedBy { if (it.name == first) 0 else 1 }
    }

    override fun onDeviceReady(): Boolean = gateway.onDeviceReady()

    override fun verifierAnswered(name: String) {
        preferred = name
    }

    override fun onDeviceName(): String? = gateway.onDeviceName.value
}

/** Loads the versioned prompts from assets/prompts. */
fun loadPrompts(assets: AssetManager): PipelinePrompts {
    fun load(name: String, version: String) =
        Prompt(version, assets.open("prompts/$name.$version.txt").bufferedReader().use { it.readText() })
    return PipelinePrompts(gatekeeper = load("gatekeeper", "v2"), verifier = load("verifier", "v1"))
}
