import groovy.json.JsonSlurper
plugins { id("com.android.application"); kotlin("android"); id("org.jetbrains.kotlin.plugin.compose") }
val releaseVersion = (JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>)["version"].toString()
val numbers = releaseVersion.split('.').map(String::toInt)
android {
    namespace = "org.anii.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "org.anii.app"
        minSdk = 26
        targetSdk = 35
        versionName = releaseVersion
        versionCode = numbers[0] * 1_000_000 + numbers[1] * 1_000 + numbers[2]
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    signingConfigs {
        create("release") {
            System.getenv("ANII_KEYSTORE")?.let { storeFile = file(it) }
            storePassword = System.getenv("ANII_STORE_PASSWORD")
            keyAlias = "anii"
            keyPassword = System.getenv("ANII_KEY_PASSWORD")
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
        release { signingConfig = signingConfigs.getByName("release"); isMinifyEnabled = false }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
