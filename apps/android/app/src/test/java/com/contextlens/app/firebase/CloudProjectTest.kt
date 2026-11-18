package com.contextlens.app.firebase

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudProjectTest {
    // Made-up values in the shape of a real project's; not a working key.
    private val key = "AIza" + "x".repeat(35)
    private val project = CloudProject("my-own-project", "1:555000000000:android:0123456789abcdef", key)

    private fun json(pkg: String, projectId: String = "my-own-project") = """
        {"project_info": {"project_number": "555000000000", "project_id": "$projectId"},
         "client": [
           {"client_info": {"mobilesdk_app_id": "1:555000000000:android:ffff", "android_client_info": {"package_name": "com.example.other"}},
            "api_key": [{"current_key": "other"}]},
           {"client_info": {"mobilesdk_app_id": "1:555000000000:android:0123456789abcdef", "android_client_info": {"package_name": "$pkg"}},
            "api_key": [{"current_key": "$key"}]}
         ]}
    """.trimIndent()

    @Test
    fun readsTheContextLensAppFromAGoogleServicesFile() {
        assertEquals(project, CloudProjects.fromGoogleServicesJson(json("com.contextlens.app"), "com.contextlens.app"))
    }

    @Test
    fun aFileWithoutTheAppOrNotJsonGivesNothing() {
        assertNull(CloudProjects.fromGoogleServicesJson(json("com.example.app"), "com.contextlens.app"))
        assertNull(CloudProjects.fromGoogleServicesJson("not json", "com.contextlens.app"))
        assertNull(CloudProjects.fromGoogleServicesJson("[]", "com.contextlens.app"))
        assertNull(CloudProjects.fromGoogleServicesJson("""{"project_info": {}}""", "com.contextlens.app"))
    }

    @Test
    fun validValuesHaveNoProblems() {
        assertTrue(CloudProjects.problems(project).isEmpty())
    }

    @Test
    fun eachMalformedValueIsNamed() {
        assertEquals(
            setOf(CloudProjectProblem.PROJECT_ID, CloudProjectProblem.APP_ID, CloudProjectProblem.API_KEY),
            CloudProjects.problems(CloudProject("X", "1:1:web:abc", "placeholder-not-a-key")),
        )
    }

    @Test
    fun thePlaceholderIsNeverAProject() {
        // what public builds carry (scripts/ci/google-services.placeholder.json)
        assertTrue(CloudProjects.isPlaceholder("placeholder-project"))
        assertTrue(CloudProjects.isPlaceholder(null))
        assertEquals(setOf(CloudProjectProblem.PROJECT_ID), CloudProjects.problems(project.copy(projectId = "placeholder-project")))
    }

    @Test
    fun pastedValuesAreTrimmed() {
        val pasted = CloudProject(" \"my-own-project\" ", "1:555000000000:android:0123456789abcdef\n", " $key")
        assertEquals(project, CloudProjects.clean(pasted))
    }

    @Test
    fun aConnectLinkGivesTheProjectOnlyWhenEveryValueIsValid() {
        val params = mapOf("project" to "my-own-project", "app" to "1:555000000000:android:0123456789abcdef", "key" to key)
        assertEquals(project, CloudProjects.fromConnectParams(params))
        assertNull(CloudProjects.fromConnectParams(params - "key"))
        assertNull(CloudProjects.fromConnectParams(params + ("project" to "placeholder-project")))
        assertNull(CloudProjects.fromConnectParams(params + ("app" to "1:555000000000:web:0123")))
        assertNull(CloudProjects.fromConnectParams(emptyMap()))
    }
}
