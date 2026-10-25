@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package org.anii.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable fun SettingsScreen(model: AppModel, editServer: () -> Unit) {
    val context = LocalContext.current
    if (model.snapshot == null) {
        Column(Modifier.padding(20.dp)) { Text(model.server); TextButton(onClick = editServer, enabled = !model.busy) { Text("Edit server URL") } }
        return
    }
    val settings = model.snapshot?.raw?.optJSONObject("settings")
    var capacity by rememberSaveable { mutableStateOf(settings?.text("daily_capacity_minutes", "480") ?: "480") }
    var timezone by rememberSaveable { mutableStateOf(settings?.text("timezone", "local") ?: "local") }
    var priorities by rememberSaveable { mutableStateOf(settings?.text("current_priorities") ?: "") }
    var addingProfile by remember { mutableStateOf(false) }
    var renamingProfile by remember { mutableStateOf<Pair<Int, String>?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Connection", style = MaterialTheme.typography.titleLarge)
        Text(model.server, style = MaterialTheme.typography.bodyLarge)
        OutlinedButton(onClick = editServer, enabled = !model.busy) { Text("Edit server URL") }
        Text("Saved on this device and retained through app updates. Changing servers does not delete data on either server.", style = MaterialTheme.typography.bodySmall)
        HorizontalDivider()
        Text("Profiles", style = MaterialTheme.typography.titleLarge)
        model.snapshot?.profiles?.forEach { profile -> Row {
            Text(profile.text("name"), Modifier.weight(1f))
            TextButton(onClick = { renamingProfile = profile.getInt("id") to profile.text("name") }) { Text("Rename") }
        } }
        TextButton(onClick = { addingProfile = true }) { Text("Add profile") }
        HorizontalDivider()
        Text("Planning preferences", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(capacity, { capacity = it }, label = { Text("Daily capacity (minutes)") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(timezone, { timezone = it }, label = { Text("Timezone") }, supportingText = { Text("Use local or a zone such as America/New_York") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(priorities, { priorities = it }, label = { Text("Current priorities") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        Button(onClick = { model.act("save", mapOf("dailyCapacity" to capacity, "timezone" to timezone, "currentPriorities" to priorities)) }, enabled = !model.busy) { Text("Save preferences") }
        HorizontalDivider()
        Text("Android follows your device’s light or dark theme. Long-press tasks for actions; share text from other apps to capture it in ANII.", style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${model.server}/settings"))) }) { Text("Server administration in browser") }
        Text("ANII ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium)
    }
    if (addingProfile) TextEntryDialog("New profile", busy = model.busy, close = { addingProfile = false }) { name -> model.act("createProfile", mapOf("name" to name)) { addingProfile = false } }
    renamingProfile?.let { (id, name) -> TextEntryDialog("Rename profile", name, model.busy, { renamingProfile = null }) { next -> model.act("renameProfile", mapOf("profileId" to id.toString(), "name" to next)) { renamingProfile = null } } }
}
