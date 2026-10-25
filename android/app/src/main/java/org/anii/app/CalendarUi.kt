@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package org.anii.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable fun CalendarScreen(model: AppModel, snapshot: Snapshot) {
    val data = snapshot.data
    val days = data.getJSONArray("days").let { a -> (0 until a.length()).map { a.getString(it) } }
    val view = data.text("view")
    val profile = data.text("selectedProfile")
    var selectedDay by rememberSaveable { mutableStateOf(if (snapshot.date in days) snapshot.date else data.text("anchor")) }
    var scheduling by rememberSaveable { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<Task?>(null) }
    fun navigate(date: String = data.text("anchor"), mode: String = view, person: String = profile) { model.navigate("calendar", "date=$date&view=$mode&profile=$person") }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { navigate(data.text("previous")) }, enabled = !model.busy) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Previous") }
            Text(LocalDate.parse(data.text("anchor")).format(DateTimeFormatter.ofPattern("MMMM yyyy")), Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = { navigate(data.text("next")) }, enabled = !model.busy) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, "Next") }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Row { FilterChip(view == "week", { navigate(mode = "week") }, { Text("Week") }); Spacer(Modifier.width(8.dp)); FilterChip(view == "month", { navigate(mode = "month") }, { Text("Month") }) }
            TextButton(onClick = { selectedDay = snapshot.date; navigate(snapshot.date) }, enabled = !model.busy) { Text("Today") }
        }
        ChoiceMenu(snapshot.profiles.find { it.getInt("id").toString() == profile }?.text("name") ?: "Everyone", snapshot.profiles.map { it.getInt("id") to it.text("name") } + (-1 to "Everyone")) { navigate(person = if (it == -1) "all" else it.toString()) }
        Row { listOf("M", "T", "W", "T", "F", "S", "S").forEach { Text(it, Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelSmall) } }
        days.chunked(7).forEach { week -> Row(Modifier.fillMaxWidth()) {
            week.forEachIndexed { index, day ->
                val scheduled = snapshot.tasks.count { it.raw.text("start_date") == day }
                val color = if (day == selectedDay) MaterialTheme.colorScheme.primaryContainer else if (index >= 5) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.background
                Column(Modifier.weight(1f).heightIn(min = 56.dp).background(color).clickable { selectedDay = day; if (scheduled == 0) scheduling = day }.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(day.takeLast(2).toInt().toString(), color = if (day == snapshot.date) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                    Text(if (scheduled > 0) "$scheduled" else "", style = MaterialTheme.typography.labelSmall)
                }
            }
        } }
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(LocalDate.parse(selectedDay).format(DateTimeFormatter.ofPattern("EEE, MMM d")), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = { scheduling = selectedDay }) { Icon(Icons.Outlined.Add, "Schedule task") }
        }
        LazyColumn(Modifier.weight(1f)) {
            val scheduled = snapshot.tasks.filter { it.raw.text("start_date") == selectedDay }
            if (scheduled.isEmpty()) item { Text("Tap + to schedule a task.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(scheduled, key = { it.id }) { task -> ListItem(headlineContent = { Text(task.title) }, supportingContent = { Text("${task.raw.text("assignee_name", "Everyone")}${if (task.completed) " · Completed" else ""}") }, modifier = Modifier.clickable { editing = task }) }
        }
    }
    scheduling?.let { day -> ScheduleSearch(model, snapshot, day) { scheduling = null } }
    editing?.let { task ->
        var date by rememberSaveable(task.id) { mutableStateOf(task.raw.text("start_date")) }
        var person by rememberSaveable(task.id) { mutableStateOf(if (task.raw.isNull("assignee_id")) -1 else task.raw.getInt("assignee_id")) }
        ModalBottomSheet(onDismissRequest = { if (!model.busy) editing = null }) {
            Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(task.title, style = MaterialTheme.typography.titleLarge)
                if (model.error.isNotBlank()) Text(model.error, color = MaterialTheme.colorScheme.error)
                if (!task.completed) {
                    DateField("Start date", date, !model.busy) { date = it }
                    ChoiceMenu(snapshot.profiles.find { it.optInt("id") == person }?.text("name") ?: "Everyone", snapshot.profiles.map { it.getInt("id") to it.text("name") } + (-1 to "Everyone")) { person = it }
                    Button(onClick = { model.act("schedule", mapOf("taskId" to task.id.toString(), "startDate" to date, "assigneeId" to if (person == -1) "everyone" else person.toString())) { editing = null } }, enabled = !model.busy && date.isNotBlank()) { Text("Save schedule") }
                } else Text("Completed task schedule · $date")
                TextButton(onClick = { model.act("unschedule", mapOf("taskId" to task.id.toString())) { editing = null } }, enabled = !model.busy) { Text("Remove schedule") }
            }
        }
    }
}

@Composable private fun ScheduleSearch(model: AppModel, snapshot: Snapshot, day: String, close: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var assigning by remember { mutableStateOf<Int?>(null) }
    fun schedule(id: Int, person: Int) { model.act("schedule", mapOf("taskId" to id.toString(), "startDate" to day, "assigneeId" to if (person == -1) "everyone" else person.toString())) { close() } }
    ModalBottomSheet(onDismissRequest = { if (!model.busy) close() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().padding(16.dp)) {
            Text("Schedule for $day", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(search, { search = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Search tasks") }, singleLine = true)
            if (model.error.isNotBlank()) Text(model.error, color = MaterialTheme.colorScheme.error)
            LazyColumn(Modifier.heightIn(max = 420.dp).testTag("schedule-results")) {
                items(snapshot.data.rows("searchTasks").filter { it.text("title").contains(search, true) }, key = { it.getInt("id") }) { task ->
                    ListItem(headlineContent = { Text(task.text("title")) }, modifier = Modifier.clickable(enabled = !model.busy) { schedule(task.getInt("id"), snapshot.profileId) }, trailingContent = {
                        Box { IconButton(onClick = { assigning = task.getInt("id") }, enabled = !model.busy) { Icon(Icons.Outlined.Person, "Assign to another user") }
                            DropdownMenu(assigning == task.getInt("id"), { assigning = null }) {
                                (snapshot.profiles.map { it.getInt("id") to it.text("name") } + (-1 to "Everyone")).forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { assigning = null; schedule(task.getInt("id"), id) }) }
                            }
                        }
                    })
                }
            }
        }
    }
}
