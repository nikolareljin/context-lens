package com.contextlens.app.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticsTest {
    private fun call(i: Int) = CallRecord(i.toLong(), Tier.CLOUD, "m$i", "IN_CLOUD", 10L * i, "ok")

    @Test
    fun percentIsUnknownUntilTheSizeIsKnown() {
        assertNull(downloadPercent(10, null))
        assertNull(downloadPercent(10, 0))
    }

    @Test
    fun percentIsWholeAndClamped() {
        assertEquals(33, downloadPercent(1, 3))
        assertEquals(100, downloadPercent(5, 5))
        assertEquals(100, downloadPercent(9, 5))
        assertEquals(0, downloadPercent(-1, 5))
    }

    @Test
    fun labelsDescribeEveryState() {
        assertEquals("downloading 50%", ModelState.Downloading(1, 2).label())
        assertEquals("downloading", ModelState.Downloading(1, null).label())
        assertEquals("unavailable on this device", ModelState.Unavailable.label())
        assertEquals("error: boom", ModelState.Failed("boom").label())
    }

    @Test
    fun callLogKeepsTheNewestFirstAndIsBounded() {
        val log = CallLog(capacity = 3)
        (1..5).forEach { log.add(call(it)) }
        assertEquals(listOf("m5", "m4", "m3"), log.entries.value.map { it.model })
    }

    @Test(expected = IllegalArgumentException::class)
    fun callLogNeedsAPositiveCapacity() {
        CallLog(capacity = 0)
    }

    @Test
    fun reportListsTheFactsAndCalls() {
        val report = buildReport(
            ReportInfo(
                appVersion = "0.1.0",
                device = "Phone X",
                appCheck = "debug",
                signIn = "Anonymous",
                model = ModelState.Available,
                onDeviceModelName = "nano-x",
                cloudModel = "m2",
                calls = listOf(call(2), call(1)),
            ),
        )
        assertTrue(report.contains("on-device model: available (nano-x)"))
        assertTrue(report.contains("cloud model: m2"))
        assertTrue(report.contains("  CLOUD m2 -> IN_CLOUD, 20 ms, ok"))
        assertFalse(report.endsWith("\n"))
    }

    @Test
    fun redactRemovesUrlsAppIdsAndProjectNumbers() {
        val msg = "API not used in project 555000111222, see https://console.example.com/x?a=1 for 1:555000111222:android:66ac"
        val out = redact(msg)
        assertEquals("API not used in project <number>, see <url> for <app>", out)
        assertEquals("HTTP 403 in 20 ms", redact("HTTP 403 in 20 ms"))
    }

    @Test
    fun reportRedactsErrorsAndSignInFailures() {
        val failed = CallRecord(1, Tier.CLOUD, "m", null, 5, "ServerException: project 123456789 denied")
        val report = buildReport(
            ReportInfo("0.1.0", "Phone X", "debug", "Failed: see https://x.example/y", ModelState.Unknown, null, null, listOf(failed)),
        )
        assertTrue(report.contains("sign-in: Failed: see <url>"))
        assertTrue(report.contains("project <number> denied"))
        assertFalse(report.contains("123456789"))
    }

    @Test
    fun reportWithoutCallsSaysSo() {
        val report = buildReport(
            ReportInfo("0.1.0", "Phone X", "debug", "Anonymous", ModelState.Unknown, null, null, emptyList()),
        )
        assertTrue(report.contains("on-device model: not checked\n"))
        assertTrue(report.contains("cloud model: not tested"))
        assertTrue(report.endsWith("calls: none"))
    }
}
