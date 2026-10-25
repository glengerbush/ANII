package org.anii.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject

class AppModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("connection", 0)
    var server by mutableStateOf(prefs.getString("server", "") ?: ""); private set
    var profileId by mutableStateOf(prefs.getInt("profile", 0)); private set
    var screen by mutableStateOf("now"); private set
    var query by mutableStateOf(""); private set
    var snapshot by mutableStateOf<Snapshot?>(null); private set
    var busy by mutableStateOf(false); private set
    var message by mutableStateOf(""); private set
    var error by mutableStateOf(""); private set
    var sharedText by mutableStateOf("")
    var checkResult by mutableStateOf<JSONObject?>(null)
    private var loading: Job? = null
    private val api get() = ApiClient(server, profileId)
    init { if (server.isNotEmpty()) refresh() }

    fun connect(value: String, done: () -> Unit = {}) {
        if (busy) return
        busy = true; error = ""
        viewModelScope.launch {
            try {
                val normalized = normalizeServerUrl(value)
                val id = if (normalized == server) profileId else 0
                val next = ApiClient(normalized, id).read("now")
                check(prefs.edit().putString("server", normalized).putInt("profile", next.profileId).commit()) { "Could not save this connection on your device." }
                server = normalized; profileId = next.profileId; screen = "now"; query = ""; snapshot = next; checkResult = null
                done()
            } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Could not connect. Check the URL and network." }
            finally { busy = false }
        }
    }
    fun navigate(view: String, params: String = "") {
        if (busy) return
        screen = view; query = params; snapshot = null; error = ""; refresh()
    }
    fun switchProfile(id: Int) {
        if (busy) return
        profileId = id; prefs.edit().putInt("profile", id).apply(); checkResult = null; snapshot = null; refresh()
    }
    fun refresh() {
        if (server.isEmpty() || busy) return
        loading?.cancel(); busy = true; error = ""
        loading = viewModelScope.launch {
            try { snapshot = api.read(screen, query); profileId = snapshot!!.profileId }
            catch (e: Exception) { if (e is CancellationException) throw e; error = "Could not refresh. ${e.message ?: "Check your connection."}" }
            finally { busy = false }
        }
    }
    fun act(action: String, fields: Map<String, String>, view: String = screen, params: String = query,
            done: (JSONObject) -> Unit = {}) {
        if (busy) return
        val date = snapshot?.date ?: ""
        busy = true; error = ""; message = ""
        viewModelScope.launch {
            var saved = false
            try {
                val result = api.act(view, params, action, mapOf("profileId" to profileId.toString(), "planDate" to date) + fields)
                saved = true
                if (action == "sanity") checkResult = result
                done(result)
                message = if (result.has("aiError") && !result.isNull("aiError")) "Message saved. AI could not finish; retry from Capture." else "Saved"
                snapshot = api.read(screen, query)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = if (saved) "Saved, but the list could not refresh. Refresh to see the change." else e.message ?: "Could not confirm the change. Refresh before retrying."
            } finally { busy = false }
        }
    }
    fun clearMessage() { message = "" }
}
