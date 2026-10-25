package org.anii.app

import java.net.URI

/** A server root, never a page, credential container, query, or fragment. */
fun normalizeServerUrl(input: String): String {
    val value = input.trim().trimEnd('/')
    require(value.isNotEmpty()) { "Enter your ANII server URL." }
    val uri = try { URI(value) } catch (_: Exception) { throw IllegalArgumentException("Enter a valid http:// or https:// server URL.") }
    require(uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank()) { "Include http:// or https:// and a server address." }
    require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) { "Use the server root URL without credentials, a query, or a fragment." }
    require(uri.port == -1 || uri.port in 1..65535) { "Enter a valid port number." }
    require(uri.normalize().rawPath == uri.rawPath) { "Use the server root without relative path segments." }
    return value
}
