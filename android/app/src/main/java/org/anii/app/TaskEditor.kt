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
    var notes by rememberSaveable(task.id) { mutableStateOf(task.details) }
    var duration by rememberSaveable(task.id) { mutableStateOf(task.duration) }
    var due by rememberSaveable(task.id) { mutableStateOf(task.dueDate) }
    var effort by rememberSaveable(task.id) { mutableStateOf(task.effortHours) }
    var lead by rememberSaveable(task.id) { mutableStateOf(task.leadTimeDays.toString()) }
    var start by rememberSaveable(task.id) { mutableStateOf(task.startDate) }
    var assignee by rememberSaveable(task.id) { mutableStateOf(task.assignment.choice) }
    var savedStart by rememberSaveable(task.id) { mutableStateOf(start) }
    var savedAssignee by rememberSaveable(task.id) { mutableStateOf(assignee) }
    var deleting by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val dirty = title != task.title || notes != task.details || duration != task.duration || due != task.dueDate ||
        effort != task.effortHours || lead != task.leadTimeDays.toString() ||
        start != savedStart || assignee != savedAssignee
    var dependencySearch by rememberSaveable { mutableStateOf("") }
    var dependenciesOpen by remember { mutableStateOf(false) }
    val meta = snapshot.taskDetails(task.id)
    fun assign(person: Int) {
        if (model.busy) return
        val assignment = Assignment.fromChoice(person)
        val date = if (assignment == Assignment.NoOne) "" else start.ifBlank { snapshot.date }
        model.changeTask(TaskChange.assign(task.id, assignment, date)) {
            start = date; assignee = person; savedStart = date; savedAssignee = person
        }
    }
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
            Button(onClick = { model.changeTask(TaskChange.edit(task.id, TaskEdit(title, notes, duration, due, effort, lead)), close) }, enabled = !model.busy && title.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Save task") }
            HorizontalDivider()
            Text("Schedule", style = MaterialTheme.typography.titleMedium)
            if (!task.completed) {
                DateField("Start date", start, !model.busy) { start = it }
                ChoiceMenu("Assigned to: " + Assignment.fromChoice(assignee).label(snapshot.people), Assignment.choices(snapshot.people), enabled = !model.busy) { assign(it) }
                Text("Assignment saves immediately. No one removes this task from all queues.", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { assign(assignee) }, enabled = !model.busy) { Text("Save schedule") }
            } else Text("Completed${if (start.isNotEmpty()) " · Started $start" else ""}")
            HorizontalDivider()
            Text("Projects", style = MaterialTheme.typography.titleMedium)
            snapshot.data.rows("projects").filter { it.getInt("id") in task.projects }.forEach { project ->
                InputChip(selected = true, onClick = { model.changeTask(TaskChange.project(task.id, project.getInt("id"), false)) }, label = { Text(project.text("name")) }, trailingIcon = { Icon(Icons.Outlined.Close, "Remove project") }, enabled = !model.busy)
            }
            ChoiceMenu("Add project", snapshot.data.rows("projects").filter { it.getInt("id") !in task.projects }.map { it.getInt("id") to it.text("name") }) { id -> model.changeTask(TaskChange.project(task.id, id, true)) }
            HorizontalDivider()
            Text("Prerequisites", style = MaterialTheme.typography.titleMedium)
            meta.prerequisites.forEach { dep -> Row {
                Text(dep.title, Modifier.weight(1f))
                IconButton(onClick = { model.changeTask(TaskChange.dependency(task.id, dep.taskId, false)) }, enabled = !model.busy) { Icon(Icons.Outlined.Close, "Remove dependency") }
            } }
            TextButton(onClick = { dependenciesOpen = !dependenciesOpen }) { Text("Add dependency") }
            if (dependenciesOpen) {
                OutlinedTextField(dependencySearch, { dependencySearch = it }, label = { Text("Search tasks") }, modifier = Modifier.fillMaxWidth())
                snapshot.availableTasks.filter { it.id != task.id && it.title.contains(dependencySearch, true) }.take(8).forEach { dep -> TextButton(onClick = { model.changeTask(TaskChange.dependency(task.id, dep.id, true)) { dependenciesOpen = false } }, enabled = !model.busy) { Text(dep.title) } }
            }
            if (meta.history.isNotEmpty()) {
                var history by remember { mutableStateOf(false) }
                TextButton(onClick = { history = !history }) { Text(if (history) "Hide history" else "Show history") }
                if (history) meta.history.forEach { Text("${it.name.replace('_', ' ')} · ${it.createdAt}", style = MaterialTheme.typography.bodySmall) }
            }
            TextButton(onClick = { deleting = true }, enabled = !model.busy, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete task") }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Discard unsaved edits?") }, text = { Text("Your task changes have not been saved.") }, confirmButton = { TextButton(onClick = close) { Text("Discard") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep editing") } })
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("Delete task?") }, text = { Text("This removes ${task.title} from every profile and project.") }, confirmButton = { TextButton(onClick = { model.changeTask(TaskChange.delete(task.id), close) }, enabled = !model.busy) { Text("Delete") } }, dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } })
}
