package org.anii.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

fun JSONObject.text(key: String, fallback: String = ""): String = if (isNull(key)) fallback else optString(key, fallback)
fun JSONObject.rows(key: String): List<JSONObject> = optJSONArray(key)?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } } ?: emptyList()
fun JSONObject.ids(key: String): Set<Int> = optJSONArray(key)?.let { array -> (0 until array.length()).map { array.optInt(it) }.toSet() } ?: emptySet()

data class Task(val raw: JSONObject) {
    val id = raw.getInt("id")
    val title = raw.text("title")
    val completed = raw.text("state") == "completed"
    val queued = raw.optBoolean("queued")
    val section = raw.text("section")
    val projects = raw.ids("project_ids")
}

data class Snapshot(val raw: JSONObject) {
    val data: JSONObject = raw.getJSONObject("data")
    val profiles = raw.rows("profiles")
    val profileId = raw.getJSONObject("activeProfile").getInt("id")
    val profileName = raw.getJSONObject("activeProfile").getString("name")
    val date = raw.getString("currentDate")
    val tasks get() = data.rows("tasks").map(::Task)
}

class ApiClient(private val server: String, private val profileId: Int) {
    suspend fun read(view: String, query: String = ""): Snapshot {
        val data = request(view, query, null)
        require(data.optInt("apiVersion") == 1) { "This server needs a compatible ANII update (0.6.0 or later)." }
        return Snapshot(data)
    }
    suspend fun act(view: String, query: String, action: String, fields: Map<String, String>): JSONObject =
        request(view, query, JSONObject().put("action", action).put("fields", JSONObject(fields)))

    private suspend fun request(view: String, query: String, body: JSONObject?): JSONObject = withContext(Dispatchers.IO) {
        val connection = URI("$server/api/mobile/$view${if (query.isEmpty()) "" else "?$query"}").toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = if (view == "chat" || body?.optString("action") == "sanity") 180_000 else 30_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("X-ANII-Client", "android-v1")
            if (profileId > 0) connection.setRequestProperty("Cookie", "life_profile=$profileId")
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            if (code in 300..399) error("Server redirected the request. Use its final URL; proxy login pages are not supported by this client.")
            if (code == 401 || code == 403) error("Server denied access. Check your network or proxy access settings.")
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val result = try { JSONObject(text) } catch (_: Exception) { error("This address did not return ANII data. Check the server URL and update the server to 0.6.0 or later.") }
            if (code !in 200..299) error(result.text("error", "Server error ($code). Try again."))
            result
        } finally { connection.disconnect() }
    }
}
