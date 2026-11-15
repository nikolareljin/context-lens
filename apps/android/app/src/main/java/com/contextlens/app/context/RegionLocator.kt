package com.contextlens.app.context

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * Finds the user's area once, on request: a coarse position (Android blurs it,
 * whichever provider answers),
 * matched against the bundled city table. The position is used here and dropped;
 * only the city, area and country are kept, in memory.
 */
class RegionLocator(private val context: Context) {
    private val resolver: OfflineRegionResolver by lazy {
        OfflineRegionResolver.parse(context.assets.open("cities.tsv").reader())
    }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** The current area, or null when no coarse position is available. */
    suspend fun locate(): Region? {
        if (!hasPermission()) return null
        val location = coarseLocation() ?: return null
        return withContext(Dispatchers.Default) { resolver.resolve(location.latitude, location.longitude) }
    }

    @Suppress("MissingPermission") // checked in locate()
    private suspend fun coarseLocation(): Location? {
        val manager = context.getSystemService(LocationManager::class.java) ?: return null
        // With coarse permission every provider returns a blurred position.
        val candidates = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.hasProvider(LocationManager.FUSED_PROVIDER)) {
                add(LocationManager.FUSED_PROVIDER)
            }
            add(LocationManager.NETWORK_PROVIDER)
            add(LocationManager.GPS_PROVIDER)
        }
        val provider = candidates.firstOrNull { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
            ?: return manager.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return manager.getLastKnownLocation(provider) ?: manager.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
        }
        return suspendCancellableCoroutine { cont ->
            val signal = android.os.CancellationSignal()
            cont.invokeOnCancellation { signal.cancel() }
            manager.getCurrentLocation(provider, signal, ContextCompat.getMainExecutor(context)) { cont.resume(it) }
        }
    }
}
