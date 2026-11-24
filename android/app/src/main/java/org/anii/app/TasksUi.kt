@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
package org.anii.app

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import org.json.JSONObject

private data class TaskRow(val key: String, val label: String = "", val task: Task? = null, val chore: JSONObject? = null)
@Composable fun TasksScreen(model: AppModel, snapshot: Snapshot) {
    var search by rememberSaveable { mutableStateOf("") }
    var projectFilter by rememberSaveable { mutableStateOf(0) }
    var assigneeFilter by rememberSaveable { mutableStateOf(0) }
    var creatorFilter by rememberSaveable { mutableStateOf(0) }
    var blocked by rememberSaveable { mutableStateOf(false) }
    var due by rememberSaveable { mutableStateOf(false) }
    var showCompleted by rememberSaveable { mutableStateOf(false) }
    var selected by remember { mutableStateOf<Task?>(null) }
    var menu by remember { mutableStateOf<Task?>(null) }
    var dismissedWarning by rememberSaveable { mutableStateOf("") }
    var follow by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    val listState = rememberLazyListState()
    val haptic = LocalHapticFeedback.current
    val data = snapshot.data
    val planned = data.ids("plannedTaskIds")
    val isBacklog = model.screen == "backlog"
    val isProject = model.screen == "project"
    val isNow = model.screen == "now"
    val projects = data.rows("projects")
    val profileOptions = snapshot.profiles.map { it.getInt("id") to it.text("name") }
    fun matchesFilters(task: Task): Boolean =
        (search.isBlank() || (task.title + " " + task.details).contains(search, true)) &&
        (projectFilter == 0 || if (projectFilter == -1) task.projects.isEmpty() else projectFilter in task.projects) &&
        (!blocked || task.completed || task.blocked) && (!due || task.dueDate.isNotEmpty()) &&
        (!isBacklog || when (assigneeFilter) {
            0 -> true
            -1 -> task.assignment == Assignment.Everyone
            -2 -> task.assignment == Assignment.NoOne
            else -> task.assignment == Assignment.Person(assigneeFilter)
        }) && (!isBacklog || when (creatorFilter) {
            0 -> true
            -1 -> task.creatorId == null
            else -> task.creatorId == creatorFilter
        })
    val tasks = snapshot.tasks.filter(::matchesFilters)
    val rows = buildList {
        if (isNow || isBacklog) {
            val groups = if (isNow) listOf("Focus", "Queue") else listOf("Queued up", "Not queued")
            groups.forEachIndexed { i, name ->
                if (isNow && i == 1) {
                    add(TaskRow("heading:chores", "Chores"))
                    data.rows("dueChores").forEach { add(TaskRow("chore:${it.getInt("id")}", chore = it)) }
                    if (data.rows("dueChores").isEmpty()) add(TaskRow("empty:chores", "No chores due for you."))
                }
                add(TaskRow("heading:$name", name))
                tasks.filter { (if (isNow) it.section == "focus" else it.queued) == (i == 0) }.forEach { add(TaskRow("task:${it.id}", task = it)) }
            }
        } else tasks.filter { model.screen == "completed" || !it.completed }.forEach { add(TaskRow("task:${it.id}", task = it)) }
        val complete = if (isProject) tasks.filter { it.completed } else snapshot.completedTasks.filter(::matchesFilters)
        if (complete.isNotEmpty()) {
            add(TaskRow("completed-toggle", "${if (showCompleted) "Hide" else "Show"} completed (${complete.size})"))
            if (showCompleted) complete.forEach { add(TaskRow("task:${it.id}", task = it)) }
        }
    }
    fun action(task: Task, change: TaskChange) {
        val offset = listState.layoutInfo.visibleItemsInfo.find { it.key == "task:${task.id}" }?.offset ?: 0
        model.changeTask(change) { follow = task.id to offset; haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    }
    LaunchedEffect(model.snapshot) {
        follow?.let { (id, offset) ->
            val index = rows.indexOfFirst { it.task?.id == id }
            if (index >= 0) listState.scrollToItem(index, -offset)
            follow = null
        }
    }
    Column(Modifier.fillMaxSize()) {
        if (isProject) {
            val project = data.getJSONObject("project")
            Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(project.text("name"), Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                TextButton(onClick = { model.act("complete", mapOf("completed" to (project.text("state") != "archived").toString())) }, enabled = !model.busy) { Text(if (project.text("state") == "archived") "Reopen project" else "Mark complete") }
            }
        }
        if (isBacklog || model.screen == "completed") {
            OutlinedTextField(search, { search = it }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp), label = { Text("Search tasks") }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Outlined.Close, "Clear search") } })
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ChoiceMenu(if (projectFilter == -1) "No project" else projects.find { it.optInt("id") == projectFilter }?.text("name") ?: "Project", listOf(0 to "All projects", -1 to "None") + projects.map { it.getInt("id") to it.getString("name") }) { projectFilter = it }
                if (isBacklog) { FilterChip(blocked, { blocked = !blocked }, { Text("Blocked") }); FilterChip(due, { due = !due }, { Text("Due") }) }
            }
        }
        if (isBacklog) {
            FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoiceMenu("Assigned to: " + when (assigneeFilter) { -1 -> "Everyone"; -2 -> "Unassigned"; else -> profileOptions.find { it.first == assigneeFilter }?.second ?: "All" }, listOf(0 to "All", -1 to "Everyone", -2 to "Unassigned") + profileOptions) { assigneeFilter = it }
                if (assigneeFilter != 0) IconButton(onClick = { assigneeFilter = 0 }) { Icon(Icons.Outlined.Close, "Clear assignment filter") }
                ChoiceMenu("Created by: " + when (creatorFilter) { -1 -> "Unknown"; else -> profileOptions.find { it.first == creatorFilter }?.second ?: "All" }, listOf(0 to "All", -1 to "Unknown") + profileOptions) { creatorFilter = it }
                if (creatorFilter != 0) IconButton(onClick = { creatorFilter = 0 }) { Icon(Icons.Outlined.Close, "Clear creator filter") }
            }
        }
        if (isNow) {
            val warnings = data.rows("warnings").map { it.text("message") }
            val warningKey = "${snapshot.date}:${snapshot.profileId}:$warnings"
            if (warnings.isNotEmpty() && dismissedWarning != warningKey) Surface(color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.padding(16.dp)) {
                Column(Modifier.padding(16.dp)) { Row { Text("Needs attention", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall); IconButton(onClick = { dismissedWarning = warningKey }) { Icon(Icons.Outlined.Close, "Dismiss needs attention") } }; warnings.forEach { Text(it, style = MaterialTheme.typography.bodySmall) } }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.End) { TextButton(onClick = { model.act("sanity", emptyMap()) }, enabled = !model.busy) { Text("Check plan") } }
        }
        if (rows.none { it.task != null }) Text("No tasks here yet.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyColumn(state = listState, modifier = Modifier.weight(1f), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 100.dp)) {
            itemsIndexed(rows, key = { _, row -> row.key }) { _, row ->
                val task = row.task
                if (row.chore != null) { ChoreRow(model, snapshot, row.chore) } else if (task == null) {
                    if (row.key == "completed-toggle") TextButton(onClick = { showCompleted = !showCompleted }) { Text(row.label) }
                    else Text(row.label, Modifier.padding(top = 20.dp, bottom = 8.dp, start = 4.dp), style = MaterialTheme.typography.titleMedium)
                } else {
                    val queued = task.queued || task.id in planned || isNow
                    ListItem(
                        modifier = Modifier.animateItem().combinedClickable(onClick = { selected = task }, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu = task }),
                        headlineContent = { Text(task.title, textDecoration = if (task.completed) TextDecoration.LineThrough else null) },
                        supportingContent = { val detail = listOfNotNull(task.duration.ifBlank { null }, task.dueDate.ifBlank { null }?.let { "Due $it" }, if (queued && !isNow && !task.completed) "Queued up" else null).joinToString(" · "); if (detail.isNotEmpty()) Text(detail) },
                        leadingContent = { Checkbox(task.completed, { action(task, TaskChange.complete(task.id, !task.completed)) }, modifier = Modifier.semantics { contentDescription = if (task.completed) "Reopen ${task.title}" else "Complete ${task.title}" }, enabled = !model.busy) },
                        trailingContent = { IconButton(onClick = { menu = task }, enabled = !model.busy) { Icon(Icons.Outlined.MoreVert, "Actions for ${task.title}") } },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
                }
            }
        }
    }
    selected?.let { original ->
        val current = (snapshot.tasks + snapshot.completedTasks).find { it.id == original.id } ?: original
        TaskEditor(model, snapshot, current) { selected = null }
    }
    menu?.let { task ->
        ModalBottomSheet(onDismissRequest = { menu = null }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
                Text(task.title, style = MaterialTheme.typography.titleLarge)
                fun run(change: TaskChange) { menu = null; action(task, change) }
                TextButton(onClick = { menu = null; selected = task }) { Text("Edit task") }
                if (!task.completed) {
                    val queued = task.queued || task.id in planned || isNow
                    TextButton(onClick = { run(TaskChange.queue(task.id, !queued)) }) { Text(if (queued) "Unqueue for today" else "Queue up") }
                    if (isNow) TextButton(onClick = { run(TaskChange.focus(task.id, task.section != "focus")) }) { Text(if (task.section == "focus") "Move to Queue" else "Move to Focus") }
                    model.taskLocation?.let { location ->
                        listOf(-1 to "Move up", 1 to "Move down").forEach { (delta, label) ->
                            val change = TaskChange.move(task, tasks, location, delta)
                            TextButton(enabled = change != null, onClick = { change?.let(::run) }) { Text(label) }
                        }
                    }
                }
            }
        }
    }
    model.checkResult?.takeIf { isNow }?.let { result -> CheckPlanSheet(model, result) }
}

@Composable fun ChoiceMenu(label: String, options: List<Pair<Int, String>>, enabled: Boolean = true, selected: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box { TextButton(onClick = { open = true }, enabled = enabled) { Text(label, maxLines = 1); Icon(Icons.Outlined.ArrowDropDown, null) }
        DropdownMenu(open, { open = false }) { options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { open = false; selected(id) }) } }
    }
}

@Composable fun ProjectsScreen(model: AppModel, snapshot: Snapshot) {
    var history by rememberSaveable { mutableStateOf(false) }
    var rename by remember { mutableStateOf<JSONObject?>(null) }
    val active = snapshot.data.rows("projects")
    val completed = snapshot.data.rows("completedProjects")
    LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 100.dp)) {
        itemsIndexed(active + if (history) completed else emptyList(), key = { _, p -> p.getInt("id") }) { _, project ->
            ListItem(headlineContent = { Text(project.text("name"), style = MaterialTheme.typography.titleMedium) }, supportingContent = { Text(if (project.text("state") == "archived") "Completed" else "${project.optInt("open_count")} open tasks") },
                trailingContent = { IconButton(onClick = { rename = project }) { Icon(Icons.Outlined.Edit, "Rename project") } },
                modifier = Modifier.combinedClickable(onClick = { model.navigate("project", "id=${project.getInt("id")}") }, onLongClick = { rename = project }))
            HorizontalDivider()
        }
        if (completed.isNotEmpty()) item { TextButton(onClick = { history = !history }) { Text("${if (history) "Hide" else "Show"} completed projects (${completed.size})") } }
        if (active.isEmpty()) item { Text("No active projects. Add one to gather related tasks.", Modifier.padding(16.dp)) }
    }
    rename?.let { project -> TextEntryDialog("Rename project", project.text("name"), model.busy, { rename = null }) { name -> model.act("rename", mapOf("id" to project.getInt("id").toString(), "name" to name)) { rename = null } } }
}
