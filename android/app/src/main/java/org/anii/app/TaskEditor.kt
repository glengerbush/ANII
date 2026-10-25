@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package org.anii.app

import android.app.DatePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.LocalDate

@Composable fun DateField(label: String, value: String, enabled: Boolean = true, onChange: (String) -> Unit) {
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = {
            val date = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now())
            DatePickerDialog(context, { _, year, month, day -> onChange(LocalDate.of(year, month + 1, day).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
        }, enabled = enabled, modifier = Modifier.weight(1f)) { Text("$label: ${value.ifBlank { "Not set" }}") }
        if (value.isNotBlank()) IconButton(onClick = { onChange("") }, enabled = enabled) { Icon(Icons.Outlined.Close, "Clear $label") }
    }
}

@Composable fun TaskEditor(model: AppModel, snapshot: Snapshot, task: Task, close: () -> Unit) {
    var title by rememberSaveable(task.id) { mutableStateOf(task.title) }
    var notes by rememberSaveable(task.id) { mutableStateOf(task.raw.text("details")) }
    var duration by rememberSaveable(task.id) { mutableStateOf(task.raw.text("duration_bucket")) }
    var due by rememberSaveable(task.id) { mutableStateOf(task.raw.text("due_at")) }
    var effort by rememberSaveable(task.id) { mutableStateOf(if (task.raw.isNull("remaining_effort_minutes")) "" else (task.raw.optInt("remaining_effort_minutes") / 60.0).toString()) }
    var lead by rememberSaveable(task.id) { mutableStateOf(task.raw.optInt("lead_time_days").toString()) }
    var start by rememberSaveable(task.id) { mutableStateOf(task.raw.text("start_date")) }
    var assignee by rememberSaveable(task.id) { mutableStateOf(if (start.isBlank()) snapshot.profileId else if (task.raw.isNull("assignee_id")) -1 else task.raw.optInt("assignee_id")) }
    var deleting by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val dirty = title != task.title || notes != task.raw.text("details") || duration != task.raw.text("duration_bucket") || due != task.raw.text("due_at") ||
        effort != (if (task.raw.isNull("remaining_effort_minutes")) "" else (task.raw.optInt("remaining_effort_minutes") / 60.0).toString()) || lead != task.raw.optInt("lead_time_days").toString() ||
        start != task.raw.text("start_date") || assignee != (if (task.raw.text("start_date").isBlank()) snapshot.profileId else if (task.raw.isNull("assignee_id")) -1 else task.raw.optInt("assignee_id"))
    var dependencySearch by rememberSaveable { mutableStateOf("") }
    var dependenciesOpen by remember { mutableStateOf(false) }
    val meta = snapshot.data.optJSONObject("taskMeta")?.optJSONObject(task.id.toString())
    // Task editing always uses the shared Backlog action surface, including Calendar and Completed.
    fun act(action: String, fields: Map<String, String>, done: () -> Unit = {}) = model.act(action, fields, "backlog", "") { done() }
    ModalBottomSheet(onDismissRequest = { if (!model.busy) { if (dirty) discard = true else close() } }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Task details", style = MaterialTheme.typography.headlineSmall)
            if (model.error.isNotBlank()) Text(model.error, color = MaterialTheme.colorScheme.error)
            OutlinedTextField(title, { title = it }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), enabled = !model.busy)
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 6, enabled = !model.busy)
            val durations = listOf("", "15m", "30m", "1h", "2h+")
            ChoiceMenu("Duration: ${duration.ifBlank { "None" }}", durations.mapIndexed { i, text -> i to text.ifBlank { "None" } }) { duration = durations[it] }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(effort, { effort = it }, label = { Text("Effort (hours)") }, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), enabled = !model.busy)
                OutlinedTextField(lead, { lead = it }, label = { Text("Lead time (days)") }, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), enabled = !model.busy)
            }
            DateField("Due date", due, !model.busy) { due = it }
            Button(onClick = { act("edit", mapOf("id" to task.id.toString(), "title" to title, "details" to notes, "duration" to duration, "dueAt" to due, "remainingHours" to effort, "leadTimeDays" to lead.ifBlank { "0" }), close) }, enabled = !model.busy && title.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Save task") }
            HorizontalDivider()
            Text("Schedule", style = MaterialTheme.typography.titleMedium)
            if (!task.completed) {
                DateField("Start date", start, !model.busy) { start = it }
                ChoiceMenu(snapshot.profiles.find { it.optInt("id") == assignee }?.text("name") ?: "Everyone", snapshot.profiles.map { it.getInt("id") to it.text("name") } + (-1 to "Everyone")) { assignee = it }
                Text("Appears in Now from this date until completed.", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { act("schedule", mapOf("taskId" to task.id.toString(), "startDate" to start, "assigneeId" to if (assignee == -1) "everyone" else assignee.toString())) }, enabled = !model.busy) { Text("Save schedule") }
            } else Text("Completed${if (start.isNotEmpty()) " · Started $start" else ""}")
            HorizontalDivider()
            Text("Projects", style = MaterialTheme.typography.titleMedium)
            snapshot.data.rows("projects").filter { it.getInt("id") in task.projects }.forEach { project ->
                InputChip(selected = true, onClick = { act("removeProject", mapOf("taskId" to task.id.toString(), "projectId" to project.getInt("id").toString())) }, label = { Text(project.text("name")) }, trailingIcon = { Icon(Icons.Outlined.Close, "Remove project") }, enabled = !model.busy)
            }
            ChoiceMenu("Add project", snapshot.data.rows("projects").filter { it.getInt("id") !in task.projects }.map { it.getInt("id") to it.text("name") }) { id -> act("addProject", mapOf("taskId" to task.id.toString(), "projectId" to id.toString())) }
            HorizontalDivider()
            Text("Prerequisites", style = MaterialTheme.typography.titleMedium)
            meta?.rows("prerequisites")?.forEach { dep -> Row {
                Text(dep.text("title"), Modifier.weight(1f))
                IconButton(onClick = { act("removeDependency", mapOf("taskId" to task.id.toString(), "prerequisiteId" to dep.optInt("prerequisite_task_id").toString())) }, enabled = !model.busy) { Icon(Icons.Outlined.Close, "Remove dependency") }
            } }
            TextButton(onClick = { dependenciesOpen = !dependenciesOpen }) { Text("Add dependency") }
            if (dependenciesOpen) {
                OutlinedTextField(dependencySearch, { dependencySearch = it }, label = { Text("Search tasks") }, modifier = Modifier.fillMaxWidth())
                snapshot.data.rows("allTasks").filter { it.optInt("id") != task.id && it.text("title").contains(dependencySearch, true) }.take(8).forEach { dep -> TextButton(onClick = { act("dependency", mapOf("taskId" to task.id.toString(), "prerequisiteId" to dep.getInt("id").toString())) { dependenciesOpen = false } }, enabled = !model.busy) { Text(dep.text("title")) } }
            }
            if (meta?.rows("history")?.isNotEmpty() == true) {
                var history by remember { mutableStateOf(false) }
                TextButton(onClick = { history = !history }) { Text(if (history) "Hide history" else "Show history") }
                if (history) meta.rows("history").forEach { Text("${it.text("event_type").replace('_', ' ')} · ${it.text("created_at")}", style = MaterialTheme.typography.bodySmall) }
            }
            TextButton(onClick = { deleting = true }, enabled = !model.busy, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete task") }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Discard unsaved edits?") }, text = { Text("Your task changes have not been saved.") }, confirmButton = { TextButton(onClick = close) { Text("Discard") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep editing") } })
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("Delete task?") }, text = { Text("This removes ${task.title} from every profile and project.") }, confirmButton = { TextButton(onClick = { act("deleteTask", mapOf("id" to task.id.toString()), close) }, enabled = !model.busy) { Text("Delete") } }, dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } })
}
