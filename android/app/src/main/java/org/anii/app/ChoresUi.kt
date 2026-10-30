@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package org.anii.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

@Composable fun ChoreRow(model: AppModel, snapshot: Snapshot, chore: JSONObject, completed: Boolean = false) {
    val count = chore.optInt("occurrence_count", 1)
    val id = chore.getInt("id").toString()
    val fields = mapOf("occurrenceId" to id, "revision" to chore.getInt("revision").toString())
    ListItem(
        headlineContent = { Text(chore.text("title") + if (count > 1) "  ×$count" else "") },
        supportingContent = { Column {
            Text((if (completed) "Scheduled " else if (chore.text("due_date") < snapshot.date) "Overdue · " else "Due ") + chore.text("due_date"))
            if (chore.text("notes").isNotBlank()) Text(chore.text("notes"))
            if (completed) Text("Completed by ${chore.text("completed_by_name", "deleted profile")}")
            else if (!model.busy) ChoiceMenu(chore.text("assignee_name", "Everyone"), snapshot.profiles.map { it.getInt("id") to it.text("name") } + (-1 to "Everyone")) { person ->
                model.act("choreAssign", fields + ("assigneeId" to if (person == -1) "everyone" else person.toString()), "chores", "")
            } else Text(chore.text("assignee_name", "Everyone"))
        } },
        leadingContent = { Checkbox(completed, {
            model.act("choreComplete", fields + ("completed" to (!completed).toString()), "chores", "")
        }, enabled = !model.busy, modifier = Modifier.semantics { contentDescription = "${if (completed) "Reopen chore" else "Complete chore"}: ${chore.text("title")}" }) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background)
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable fun ChoresScreen(model: AppModel, snapshot: Snapshot) {
    var editingId by rememberSaveable { mutableStateOf<Int?>(null) }
    var history by rememberSaveable { mutableStateOf(false) }
    var search by rememberSaveable { mutableStateOf("") }
    val chores = snapshot.data.rows("chores")
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Recurring work", style = MaterialTheme.typography.titleMedium)
            Button(onClick = { editingId = -1 }, enabled = !model.busy) { Icon(Icons.Outlined.Add, null); Text("New chore") }
        }
        LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 28.dp)) {
            item { Text("Due chores", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 12.dp)) }
            if (snapshot.data.rows("dueChores").isEmpty()) item { Text("No chores due.") }
            items(snapshot.data.rows("dueChores"), key = { "due:${it.getInt("id")}" }) { ChoreRow(model, snapshot, it) }
            item { Text("Schedules", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 12.dp))
                Text("Missed dates accumulate. One check clears the count; the next person takes the next scheduled turn.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(search, { search = it }, label = { Text("Search chores") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) }
            if (chores.isEmpty()) item { Text("Create a chore to get started.") }
            items(chores.filter { it.text("title").contains(search, true) }, key = { "schedule:${it.getInt("id")}" }) { chore ->
                Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                    Text(chore.text("title"), style = MaterialTheme.typography.titleMedium)
                    Text(choreRuleLabel(chore.getJSONObject("rule")), style = MaterialTheme.typography.bodyMedium)
                    val names = chore.ids("assigneeIds").map { person -> snapshot.profiles.find { it.optInt("id") == person }?.text("name") ?: "Deleted profile" }
                    Text(if (names.isEmpty()) "Everyone" else names.joinToString(" → "), style = MaterialTheme.typography.bodyMedium)
                    Text(if (!chore.optBoolean("active")) "Paused · outstanding chores remain" else "Next: ${chore.text("nextDate", "No matching date")}", style = MaterialTheme.typography.bodySmall)
                    Row { TextButton(onClick = { editingId = chore.getInt("id") }, enabled = !model.busy) { Text("Edit") }
                        TextButton(onClick = { model.act("active", mapOf("id" to chore.getInt("id").toString(), "revision" to chore.getInt("revision").toString(), "active" to (!chore.optBoolean("active")).toString())) }, enabled = !model.busy) { Text(if (chore.optBoolean("active")) "Pause" else "Resume") } }
                }
                HorizontalDivider()
            }
            if (snapshot.data.rows("completedChores").isNotEmpty()) item { TextButton(onClick = { history = !history }) { Text(if (history) "Hide completed chores" else "Show completed chores") } }
            if (history) items(snapshot.data.rows("completedChores"), key = { "completed:${it.getInt("id")}" }) { ChoreRow(model, snapshot, it, true) }
        }
    }
    editingId?.let { id -> ChoreEditor(model, snapshot, chores.find { it.optInt("id") == id }) { editingId = null } }
}

private fun choreRuleLabel(rule: JSONObject): String {
    val period = mapOf("daily" to "day", "weekly" to "week", "monthly" to "month", "yearly" to "year")[rule.text("frequency")] ?: "day"
    val n = rule.optInt("interval", 1)
    val parts = mutableListOf("Every ${if (n == 1) period else "$n ${period}s"}")
    if (rule.ids("weekdays").isNotEmpty()) parts += rule.ids("weekdays").map { listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")[it] }.joinToString(", ")
    if (rule.ids("monthDays").isNotEmpty()) parts += "On " + rule.ids("monthDays").joinToString(", ") { if (it == -1) "last day" else it.toString() }
    if (rule.ids("months").isNotEmpty()) parts += rule.ids("months").map { listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[it - 1] }.joinToString(", ")
    return parts.joinToString(" · ")
}

@Composable private fun ChoreEditor(model: AppModel, snapshot: Snapshot, chore: JSONObject?, close: () -> Unit) {
    val originalRule = chore?.optJSONObject("rule")
    val revision = remember { chore?.optInt("revision") }
    var title by rememberSaveable { mutableStateOf(chore?.text("title") ?: "") }
    var notes by rememberSaveable { mutableStateOf(chore?.text("notes") ?: "") }
    var start by rememberSaveable { mutableStateOf(originalRule?.text("startDate") ?: snapshot.date) }
    var frequency by rememberSaveable { mutableStateOf(originalRule?.text("frequency") ?: "daily") }
    var interval by rememberSaveable { mutableStateOf((originalRule?.optInt("interval") ?: 1).toString()) }
    var weekdays by rememberSaveable { mutableStateOf(originalRule?.ids("weekdays")?.toList() ?: emptyList()) }
    var monthDays by rememberSaveable { mutableStateOf(originalRule?.ids("monthDays")?.toList() ?: emptyList()) }
    var months by rememberSaveable { mutableStateOf(originalRule?.ids("months")?.toList() ?: emptyList()) }
    var people by rememberSaveable { mutableStateOf(chore?.ids("assigneeIds")?.toList() ?: emptyList()) }
    var advanced by rememberSaveable { mutableStateOf(monthDays.isNotEmpty() || months.isNotEmpty()) }
    var discard by remember { mutableStateOf(false) }
    val rule = JSONObject().put("startDate", start).put("frequency", frequency).put("interval", interval.toIntOrNull() ?: 0).put("weekdays", JSONArray(weekdays)).put("monthDays", JSONArray(monthDays)).put("months", JSONArray(months))
    ModalBottomSheet(onDismissRequest = { if (!model.busy) discard = true }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (chore == null) "New chore" else "Edit chore", style = MaterialTheme.typography.headlineSmall)
            if (model.error.isNotBlank()) Text(model.error, color = MaterialTheme.colorScheme.error)
            OutlinedTextField(title, { title = it }, label = { Text("Chore name") }, modifier = Modifier.fillMaxWidth(), enabled = !model.busy)
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth(), enabled = !model.busy)
            if (!model.busy) ChoiceMenu("Schedule presets", listOf("Daily", "Weekdays", "Weekly", "Every 2 weeks", "Twice a month", "Monthly", "Quarterly", "Yearly").mapIndexed { i, label -> i to label }) { index ->
                weekdays = if (index == 1) listOf(1, 2, 3, 4, 5) else emptyList(); monthDays = if (index == 4) listOf(1, 15) else emptyList(); months = emptyList()
                frequency = when (index) { 2, 3 -> "weekly"; 4, 5, 6 -> "monthly"; 7 -> "yearly"; else -> "daily" }
                interval = when (index) { 3 -> "2"; 6 -> "3"; else -> "1" }
            }
            DateField("Start date", start, !model.busy) { start = it }
            OutlinedTextField(interval, { interval = it }, label = { Text("Repeat every") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, enabled = !model.busy)
            if (!model.busy) ChoiceMenu(frequency.replaceFirstChar { it.uppercase() }, listOf("daily", "weekly", "monthly", "yearly").mapIndexed { i, text -> i to text }) { frequency = listOf("daily", "weekly", "monthly", "yearly")[it] }
            Text("Weekdays (optional)", style = MaterialTheme.typography.titleMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf(1, 2, 3, 4, 5, 6, 0).forEach { day -> FilterChip(day in weekdays, { weekdays = if (day in weekdays) weekdays - day else (weekdays + day).sorted() }, { Text(listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")[day]) }, enabled = !model.busy) } }
            TextButton(onClick = { advanced = !advanced }) { Text(if (advanced) "Hide month options" else "Choose months / days of month") }
            if (advanced) {
                Text("Days of month (optional)", style = MaterialTheme.typography.titleMedium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { ((1..31).toList() + -1).forEach { day -> FilterChip(day in monthDays, { monthDays = if (day in monthDays) monthDays - day else (monthDays + day).sorted() }, { Text(if (day == -1) "Last day" else "$day") }, enabled = !model.busy) } }
                Text("Months (optional)", style = MaterialTheme.typography.titleMedium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { (1..12).forEach { month -> FilterChip(month in months, { months = if (month in months) months - month else (months + month).sorted() }, { Text(listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[month - 1]) }, enabled = !model.busy) } }
            }
            Text(choreRuleLabel(rule), style = MaterialTheme.typography.bodyMedium)
            Text("All filters apply together. Without day/month selections, the start date sets weekly, monthly and yearly defaults. Missing dates, such as February 31, are skipped.", style = MaterialTheme.typography.bodySmall)
            Text("Who does it?", style = MaterialTheme.typography.titleMedium)
            Text("No selection means Everyone. Select multiple people to take turns after completion.", style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { snapshot.profiles.forEach { profile -> val person = profile.getInt("id"); FilterChip(person in people, { people = if (person in people) people - person else people + person }, { Text(profile.text("name")) }, enabled = !model.busy) } }
            if (people.size > 1) people.forEachIndexed { index, person -> Row(Modifier.fillMaxWidth()) {
                Text("${index + 1}. ${snapshot.profiles.find { it.optInt("id") == person }?.text("name") ?: "Deleted profile"}", Modifier.weight(1f))
                TextButton(enabled = index > 0 && !model.busy, onClick = { val copy = people.toMutableList(); java.util.Collections.swap(copy, index, index - 1); people = copy }) { Text("Earlier") }
            } }
            if (chore != null) Text("Schedule changes start tomorrow. Outstanding chores keep their dates and assignments.", style = MaterialTheme.typography.bodySmall)
            Button(onClick = {
                val fields = mapOf("title" to title, "notes" to notes, "rule" to rule.toString(), "assigneeIds" to JSONArray(people).toString()) + if (chore == null) emptyMap() else mapOf("id" to chore.getInt("id").toString(), "revision" to revision.toString())
                model.act(if (chore == null) "create" else "edit", fields, "chores", "") { close() }
            }, enabled = !model.busy && title.isNotBlank() && start.isNotBlank() && interval.toIntOrNull() in 1..1000, modifier = Modifier.fillMaxWidth()) { Text("Save chore") }
            TextButton(onClick = { discard = true }, enabled = !model.busy) { Text("Cancel") }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Discard chore edits?") }, confirmButton = { TextButton(onClick = close) { Text("Discard") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep editing") } })
}
