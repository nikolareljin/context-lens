package com.contextlens.app.ai

import com.contextlens.app.diagnostics.CallLog
import com.contextlens.app.diagnostics.CallRecord
import com.contextlens.app.diagnostics.ModelState
import com.contextlens.app.diagnostics.Tier
import com.contextlens.app.diagnostics.redact
import com.google.firebase.Firebase
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceExtension
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerationConfig
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.Tool
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Cloud model IDs to try, in order, until Remote Config provides the name.
 * Checked on Nov 14: the API names gemini-3.8-flash as the current Flash model;
 * gemini-3.1-flash-lite answers; gemini-2.5-flash is closed to new projects.
 */
val CLOUD_MODEL_CANDIDATES = listOf("gemini-3.8-flash", "gemini-3.1-flash-lite")

/** A fixed, neutral prompt: nothing personal ever goes into a diagnostics call. */
const val PROBE_PROMPT = "Reply with the single word: ready"

/**
 * The app's access to Firebase AI Logic: the on-device model (status, download,
 * warm-up) and probe calls for each tier. Calls run in [scope], so they outlive
 * the screen that started them.
 */
@OptIn(PublicPreviewAPI::class)
class ModelGateway(
    private val scope: CoroutineScope,
    val log: CallLog = CallLog(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow<ModelState>(ModelState.Unknown)
    val state: StateFlow<ModelState> = _state.asStateFlow()

    private val _onDeviceName = MutableStateFlow<String?>(null)
    val onDeviceName: StateFlow<String?> = _onDeviceName.asStateFlow()

    private val _cloudModel = MutableStateFlow<String?>(null)
    /** The first candidate that answered a cloud probe. */
    val cloudModel: StateFlow<String?> = _cloudModel.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private fun model(mode: InferenceMode, name: String): GenerativeModel = build(name, OnDeviceConfig(mode = mode))

    /** A model behind Firebase AI Logic; [name] is the cloud model (the fallback in hybrid modes). */
    fun build(
        name: String,
        onDeviceConfig: OnDeviceConfig,
        generationConfig: GenerationConfig? = null,
        tools: List<Tool>? = null,
    ): GenerativeModel = Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = name,
        generationConfig = generationConfig,
        tools = tools,
        onDeviceConfig = onDeviceConfig,
    )

    /** False when the on-device model is known to be missing or not downloaded yet. */
    fun onDeviceReady(): Boolean = when (_state.value) {
        ModelState.Unavailable, ModelState.Downloadable, is ModelState.Downloading -> false
        else -> true
    }

    private val onDevice: GenerativeModel by lazy {
        model(InferenceMode.ONLY_ON_DEVICE, CLOUD_MODEL_CANDIDATES.first())
    }

    /** Null when the on-device runtime is not part of this build. */
    private fun extension(): OnDeviceExtension =
        onDevice.onDeviceExtension ?: throw IllegalStateException("on-device support is not in this build")

    private fun launchExclusive(block: suspend () -> Unit): Job? {
        if (_busy.value) return null
        _busy.value = true
        // ATOMIC: the body always starts, so the finally below always clears the flag.
        return scope.launch(start = CoroutineStart.ATOMIC) {
            try {
                block()
            } finally {
                _busy.value = false
            }
        }
    }

    fun checkStatus() = launchExclusive { refreshStatus() }

    private suspend fun refreshStatus() {
        _state.value = ModelState.Checking
        _state.value = try {
            val ext = onDevice.onDeviceExtension
            if (ext == null) ModelState.Unavailable else when (ext.checkStatus()) {
                OnDeviceModelStatus.AVAILABLE -> ModelState.Available
                OnDeviceModelStatus.DOWNLOADABLE -> ModelState.Downloadable
                OnDeviceModelStatus.DOWNLOADING -> ModelState.Downloading(0, null)
                else -> ModelState.Unavailable
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            ModelState.Failed(e.describe())
        }
        _onDeviceName.value = if (_state.value == ModelState.Available) {
            try {
                extension().getModelName()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
        } else {
            null
        }
    }

    fun download() = launchExclusive {
        var total: Long? = null
        // Shown at once: the first progress event can take minutes while the system schedules the download.
        _state.value = ModelState.Downloading(0, null)
        try {
            extension().download().collect { status ->
                when (status) {
                    is DownloadStatus.DownloadStarted -> {
                        total = status.bytesToDownload
                        _state.value = ModelState.Downloading(0, total)
                    }
                    is DownloadStatus.DownloadInProgress ->
                        _state.value = ModelState.Downloading(status.totalBytesDownloaded, total)
                    is DownloadStatus.DownloadCompleted -> Unit
                    is DownloadStatus.DownloadFailed ->
                        _state.value = ModelState.Failed(status.exception.describe())
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.value = ModelState.Failed(e.describe())
            return@launchExclusive
        }
        if (_state.value !is ModelState.Failed) refreshStatus()
    }

    fun warmUp() = launchExclusive {
        val start = clock()
        val outcome = try {
            extension().warmUp()
            "warmed up"
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            e.describe()
        }
        log.add(CallRecord(start, Tier.ON_DEVICE, "warm-up", null, clock() - start, outcome))
    }

    fun probeOnDevice() = launchExclusive {
        // logged under the on-device model's own name; the cloud name would mislead
        probe(Tier.ON_DEVICE, _onDeviceName.value ?: "on-device model") { onDevice }
    }

    /** Tries each cloud candidate until one answers. */
    fun probeCloud() = launchExclusive {
        val names = listOfNotNull(_cloudModel.value) + CLOUD_MODEL_CANDIDATES.filter { it != _cloudModel.value }
        for (name in names) {
            if (probe(Tier.CLOUD, name) { model(InferenceMode.ONLY_IN_CLOUD, name) }) {
                _cloudModel.value = name
                return@launchExclusive
            }
        }
        _cloudModel.value = null
    }

    /**
     * One probe call; true when the model answered. The model is built inside the
     * try, so a construction error is logged instead of crashing the app scope.
     * Only metadata is logged, not the reply.
     */
    private suspend fun probe(tier: Tier, name: String, build: () -> GenerativeModel): Boolean {
        val start = clock()
        return try {
            val response = withTimeoutOrNull(PROBE_TIMEOUT_MS) { build().generateContent(PROBE_PROMPT) }
            if (response == null) {
                log.add(CallRecord(start, tier, name, null, clock() - start, "timed out"))
                false
            } else {
                val outcome = if (response.text.isNullOrBlank()) "ok, empty reply" else "ok"
                log.add(CallRecord(start, tier, name, response.inferenceSource.label(), clock() - start, outcome))
                true
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.add(CallRecord(start, tier, name, null, clock() - start, e.describe()))
            false
        }
    }
}

/** Per probe; three cloud candidates in a row stay under a minute. */
private const val PROBE_TIMEOUT_MS = 20_000L

private fun Throwable.describe(): String =
    "${javaClass.simpleName}: ${redact(message?.lineSequence()?.firstOrNull()?.take(160) ?: "no message")}"
