import java.net.URI
import java.util.Locale
import java.util.zip.ZipInputStream

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
    alias(libs.plugins.firebase.crashlytics)
}

// VERSION at the repository root is the single source of the version.
val appVersion: String = rootDir.resolve("../../VERSION").readText().trim()
val appVersionCode: Int = appVersion.split(".").map { it.toInt() }
    .let { (major, minor, patch) -> major * 10_000 + minor * 100 + patch }

/**
 * The offline city table (GeoNames, CC BY 4.0) is generated at build time rather than
 * committed: cities with at least [minPopulation] people, as
 * name<TAB>admin1 name<TAB>country code<TAB>lat<TAB>lon, coordinates to two decimals.
 * The download is cached in the build directory.
 */
abstract class GenerateCityTable : DefaultTask() {
    @get:Input abstract val minPopulation: Property<Int>
    @get:Input abstract val citiesUrl: Property<String>
    @get:Input abstract val admin1Url: Property<String>
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val admin1 = URI(admin1Url.get()).toURL().openStream().bufferedReader().useLines { lines ->
            lines.map { it.split('\t') }.filter { it.size >= 2 }.associate { it[0] to it[1] }
        }
        val rows = mutableListOf<String>()
        ZipInputStream(URI(citiesUrl.get()).toURL().openStream()).use { zip ->
            generateSequence { zip.nextEntry }.first { it.name.endsWith(".txt") }
            zip.bufferedReader().lineSequence().forEach { line ->
                val f = line.split('\t')
                val population = f.getOrNull(14)?.toLongOrNull() ?: 0L
                if (population >= minPopulation.get()) {
                    val region = admin1["${f[8]}.${f[10]}"].orEmpty()
                    val lat = "%.2f".format(Locale.ROOT, f[4].toDouble())
                    val lon = "%.2f".format(Locale.ROOT, f[5].toDouble())
                    rows += listOf(f[2], region, f[8], lat, lon).joinToString("\t")
                }
            }
        }
        check(rows.size > 1000) { "city table looks wrong: ${rows.size} rows" }
        val dir = outputDir.get().asFile
        dir.mkdirs()
        dir.resolve("cities.tsv").writeText(rows.sorted().joinToString("\n", postfix = "\n"))
    }
}

val generateCityTable = tasks.register<GenerateCityTable>("generateCityTable") {
    minPopulation.set(50_000)
    citiesUrl.set("https://download.geonames.org/export/dump/cities15000.zip")
    admin1Url.set("https://download.geonames.org/export/dump/admin1CodesASCII.txt")
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(generateCityTable, GenerateCityTable::outputDir)
    }
}

// Release signing comes from the environment (CI secrets or a local shell), never from a file in the repository.
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    namespace = "com.contextlens.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.contextlens.app"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        warningsAsErrors = false
        abortOnError = true
        checkDependencies = false
        // newer library versions are proposed by Dependabot, not by lint
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable")
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.ai)
    implementation(libs.firebase.ai.ondevice)
    implementation(libs.firebase.appcheck.playintegrity)
    debugImplementation(libs.firebase.appcheck.debug)
    implementation(libs.firebase.auth)
    implementation(libs.firebase.config)
    implementation(libs.firebase.crashlytics)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    testImplementation(libs.junit)
}
