@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package org.anii.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONObject

private val roots = listOf("now", "backlog", "projects", "calendar", "completed")
private val titles = mapOf("now" to "Now", "backlog" to "Backlog", "projects" to "Projects", "project" to "Project", "calendar" to "Calendar", "completed" to "Completed", "settings" to "Settings", "chat" to "Capture")

@Composable fun AniiApp(model: AppModel) {
    if (model.server.isEmpty()) { ConnectionScreen(model, false) {}; return }
    var connectionEditor by rememberSaveable { mutableStateOf(false) }
    var profileMenu by remember { mutableStateOf(false) }
    var adding by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val states = rememberSaveableStateHolder()
    val snapshot = model.snapshot
    BackHandler(model.screen !in roots) { if (!model.busy) model.navigate(if (model.screen == "project") "projects" else "now") }
    LaunchedEffect(model.message) { if (model.message.isNotBlank()) { snackbar.showSnackbar(model.message); model.clearMessage() } }
    Scaffold(
        topBar = { TopAppBar(title = { Text(titles[model.screen] ?: "ANII", maxLines = 1) },
            navigationIcon = { if (model.screen !in roots) IconButton(onClick = { model.navigate(if (model.screen == "project") "projects" else "now") }, enabled = !model.busy) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") } },
            actions = {
                Box {
                    IconButton(onClick = { profileMenu = true }, enabled = !model.busy) { Icon(Icons.Outlined.Person, "Change profile") }
                    DropdownMenu(expanded = profileMenu, onDismissRequest = { profileMenu = false }) {
                        snapshot?.profiles?.forEach { profile -> DropdownMenuItem(text = { Text(profile.text("name")) }, onClick = { profileMenu = false; model.switchProfile(profile.getInt("id")) }) }
                    }
                }
                IconButton(onClick = { model.navigate("chat") }, enabled = !model.busy) { Icon(Icons.AutoMirrored.Outlined.Send, "Capture") }
                IconButton(onClick = { model.navigate("settings") }, enabled = !model.busy) { Icon(Icons.Outlined.Settings, "Settings") }
            }) },
        bottomBar = { if (model.screen in roots) NavigationBar {
            val icons = listOf(AppIcons.Bolt, Icons.Outlined.List, AppIcons.Folder, Icons.Outlined.DateRange, Icons.Outlined.CheckCircle)
            roots.forEachIndexed { i, root -> NavigationBarItem(selected = model.screen == root, onClick = { model.navigate(root, if (root == "completed") "mode=all" else "") }, enabled = !model.busy,
                icon = { Icon(icons[i], titles[root]) }, label = { Text(titles[root]!!, maxLines = 1) }) }
        } },
        floatingActionButton = { if (model.screen in listOf("now", "backlog", "projects", "project")) FloatingActionButton(onClick = { adding = true }) { Icon(Icons.Outlined.Add, if (model.screen == "projects") "New project" else "New task") } },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (model.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(snapshot?.let { "Planning as ${it.profileName}" } ?: model.server, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                IconButton(onClick = model::refresh, enabled = !model.busy) { Icon(Icons.Outlined.Refresh, "Refresh") }
            }
            if (model.error.isNotBlank()) ErrorBanner(model.error) { model.refresh() }
            if (snapshot == null && !model.busy && model.screen != "settings") {
                Column(Modifier.padding(24.dp)) { Text("Your server couldn’t be reached. Your saved address is retained."); TextButton(onClick = { connectionEditor = true }) { Text("Edit server URL") } }
            }
            states.SaveableStateProvider("${model.screen}:${model.query}:${model.profileId}") {
                when (model.screen) {
                    "settings" -> SettingsScreen(model) { connectionEditor = true }
                    "projects" -> if (snapshot != null) ProjectsScreen(model, snapshot)
                    "calendar" -> if (snapshot != null) CalendarScreen(model, snapshot)
                    "chat" -> if (snapshot != null) ChatScreen(model, snapshot)
                    else -> if (snapshot != null) TasksScreen(model, snapshot)
                }
            }
        }
    }
    if (adding || model.sharedText.isNotEmpty()) {
        val project = model.screen == "projects" && model.sharedText.isEmpty()
        TextEntryDialog(if (project) "New project" else "New task", model.sharedText, model.busy,
            close = { adding = false; model.sharedText = "" }, save = { title ->
                val view = if (model.sharedText.isNotEmpty()) "backlog" else model.screen
                model.act(if (view == "now") "quickAdd" else "create", mapOf((if (project) "name" else "title") to title), view, if (view == model.screen) model.query else "") { adding = false; model.sharedText = "" }
            })
    }
    if (connectionEditor) ModalBottomSheet(onDismissRequest = { if (!model.busy) connectionEditor = false }) { ConnectionScreen(model, true) { connectionEditor = false } }
}

@Composable fun ErrorBanner(message: String, retry: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = retry) { Text("Refresh") }
        }
    }
}

@Composable fun ConnectionScreen(model: AppModel, editing: Boolean, done: () -> Unit) {
    var url by rememberSaveable { mutableStateOf(model.server) }
    Column(Modifier.fillMaxWidth().then(if (editing) Modifier else Modifier.fillMaxHeight()).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(28.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Spacer(Modifier.height(if (editing) 4.dp else 64.dp))
        Icon(AppIcons.Bolt, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(if (editing) "Your server" else "Welcome to ANII", style = MaterialTheme.typography.headlineLarge)
        Text("Connect to your ANII server. This device remembers the address so you can get straight to your tasks next time.", style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(url, { url = it }, label = { Text("Server URL") }, placeholder = { Text("https://anii.example.com") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), enabled = !model.busy)
        if (model.error.isNotBlank()) Text(model.error, color = MaterialTheme.colorScheme.error)
        Button(onClick = { model.connect(url, done) }, enabled = !model.busy && url.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text(if (model.busy) "Connecting…" else if (editing) "Save server" else "Connect") }
        if (editing) TextButton(onClick = done, enabled = !model.busy) { Text("Cancel") }
        Text("Use the server’s network address, not localhost. HTTP is supported for trusted local networks.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable fun TextEntryDialog(title: String, initial: String = "", busy: Boolean, close: () -> Unit, save: (String) -> Unit) {
    var value by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(title) }, text = { OutlinedTextField(value, { value = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), maxLines = 5, enabled = !busy) },
        confirmButton = { TextButton(onClick = { save(value.trim()) }, enabled = !busy && value.isNotBlank()) { Text("Save") } }, dismissButton = { TextButton(onClick = close, enabled = !busy) { Text("Cancel") } })
}
