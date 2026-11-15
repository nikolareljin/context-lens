package com.contextlens.app.context

import java.io.Reader
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Turns a coarse position into the nearest larger city using a table bundled in
 * the app (GeoNames, cities of 50,000 or more), so no location ever leaves the
 * phone for a geocoder. Rows: name, area, country code, lat, lon (tab-separated).
 */
class OfflineRegionResolver(private val cities: List<City>) {
    data class City(val name: String, val area: String, val country: String, val lat: Double, val lon: Double)

    /** The nearest city within [maxKm], or null (open sea, empty table). */
    fun resolve(lat: Double, lon: Double, maxKm: Double = 150.0): Region? =
        cities.asSequence()
            .map { it to distanceKm(lat, lon, it.lat, it.lon) }
            .filter { it.second <= maxKm }
            .minByOrNull { it.second }
            ?.first
            ?.let { Region(it.name, it.area, it.country) }

    companion object {
        /** Parses the table; malformed rows are skipped. */
        fun parse(reader: Reader): OfflineRegionResolver = OfflineRegionResolver(
            reader.useLines { lines ->
                lines.mapNotNull { line ->
                    val f = line.split('\t')
                    if (f.size < 5) return@mapNotNull null
                    val lat = f[3].toDoubleOrNull() ?: return@mapNotNull null
                    val lon = f[4].toDoubleOrNull() ?: return@mapNotNull null
                    City(f[0], f[1], f[2], lat, lon)
                }.toList()
            },
        )

        /** Great-circle distance (haversine). */
        fun distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val r = 6371.0
            val dLat = Math.toRadians(lat2 - lat1)
            val dLon = Math.toRadians(lon2 - lon1)
            val a = sin(dLat / 2).pow(2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
            return 2 * r * asin(sqrt(a))
        }
    }
}
