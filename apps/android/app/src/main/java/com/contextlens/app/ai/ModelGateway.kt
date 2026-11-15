package com.contextlens.app.ai

import com.contextlens.app.diagnostics.CallLog
import com.contextlens.app.diagnostics.CallRecord
import com.contextlens.app.diagnostics.ModelState
import com.contextlens.app.diagnostics.Tier
import com.google.firebase.Firebase
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceExtension
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Cloud model IDs to try, in order, until Remote Config provides the name. */
val CLOUD_MODEL_CANDIDATES = listOf("gemini-3-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite")

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

    private fun model(mode: InferenceMode, name: String): GenerativeModel =
        Firebase.ai(backend = GenerativeBackend.googleAI())
            .generativeModel(modelName = name, onDeviceConfig = OnDeviceConfig(mode = mode))

    private val onDevice: GenerativeModel by lazy {
        model(InferenceMode.ONLY_ON_DEVICE, CLOUD_MODEL_CANDIDATES.first())
    }

    /** Null when the on-device runtime is not part of this build. */
    private fun extension(): OnDeviceExtension =
        onDevice.onDeviceExtension ?: throw IllegalStateException("on-device support is not in this build")

    private fun launchExclusive(block: suspend () -> Unit): Job? {
        if (_busy.value) return null
        _busy.value = true
        return scope.launch {
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
        if (_state.value == ModelState.Available) {
            _onDeviceName.value = runCatching { extension().getModelName() }
                .getOrNull()
        }
    }

    fun download() = launchExclusive {
        var total: Long? = null
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
        probe(Tier.ON_DEVICE, onDevice, CLOUD_MODEL_CANDIDATES.first())
    }

    /** Tries each cloud candidate until one answers. */
    fun probeCloud() = launchExclusive {
        val names = listOfNotNull(_cloudModel.value) + CLOUD_MODEL_CANDIDATES.filter { it != _cloudModel.value }
        for (name in names) {
            if (probe(Tier.CLOUD, model(InferenceMode.ONLY_IN_CLOUD, name), name)) {
                _cloudModel.value = name
                return@launchExclusive
            }
        }
    }

    /** One probe call; true when the model answered. */
    private suspend fun probe(tier: Tier, model: GenerativeModel, name: String): Boolean {
        val start = clock()
        return try {
            val response = model.generateContent(PROBE_PROMPT)
            val reply = response.text?.trim()?.take(40).orEmpty()
            log.add(CallRecord(start, tier, name, response.inferenceSource.toString(), clock() - start, "ok \"$reply\""))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.add(CallRecord(start, tier, name, null, clock() - start, e.describe()))
            false
        }
    }
}

private fun Throwable.describe(): String =
    "${javaClass.simpleName}: ${message?.lineSequence()?.firstOrNull()?.take(160) ?: "no message"}"
