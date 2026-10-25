@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package org.anii.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@Composable fun ChatScreen(model: AppModel, snapshot: Snapshot) {
    var text by rememberSaveable { mutableStateOf("") }
    var deleting by remember { mutableStateOf<Int?>(null) }
    val rows = snapshot.data.rows("messages")
    val groups = rows.groupBy { it.optInt("id") }
    Column(Modifier.fillMaxSize().imePadding()) {
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), reverseLayout = true) {
            items(groups.entries.toList().reversed(), key = { it.key }) { (id, messages) ->
                val message = messages.first()
                Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                    Text(if (message.text("role") == "user") "You" else "ANII", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(message.text("content"), Modifier.padding(vertical = 8.dp))
                    messages.filter { !it.isNull("proposal_id") }.forEach { proposal ->
                        val payload = runCatching { JSONObject(proposal.text("payload")) }.getOrDefault(JSONObject())
                        if (proposal.text("kind") == "task_changes") {
                            Text("Proposed changes", style = MaterialTheme.typography.titleSmall)
                            payload.rows("tasks").forEach { task ->
                                Text(task.text("title"), style = MaterialTheme.typography.titleMedium)
                                if (task.text("details").isNotBlank()) Text(task.text("details"))
                                Text(listOfNotNull(task.text("duration").ifBlank { null }, task.text("dueAt").ifBlank { null }?.let { "Due $it" }).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                            }
                            fun taskName(ref: String): String = payload.optJSONObject("existingTasks")?.text(ref)?.ifBlank { null }
                                ?: payload.rows("tasks").find { it.text("ref") == ref }?.text("title") ?: "Task $ref"
                            payload.rows("dependencies").forEach { edge -> Text("${taskName(edge.text("task"))} depends on ${taskName(edge.text("prerequisite"))}.", style = MaterialTheme.typography.bodySmall) }
                        } else { Text(payload.text("title"), style = MaterialTheme.typography.titleMedium); Text(payload.text("details"), style = MaterialTheme.typography.bodySmall) }
                        if (proposal.text("status") == "pending") Row {
                            Button(onClick = { model.act("accept", mapOf("id" to proposal.optInt("proposal_id").toString())) }, enabled = !model.busy) { Text("Accept") }
                            TextButton(onClick = { model.act("reject", mapOf("id" to proposal.optInt("proposal_id").toString())) }, enabled = !model.busy) { Text("Dismiss") }
                        } else Text(proposal.text("status"), style = MaterialTheme.typography.labelSmall)
                    }
                    Row {
                        if (message.text("role") == "user" && messages.none { !it.isNull("proposal_id") }) TextButton(onClick = { model.act("retry", mapOf("id" to id.toString())) }, enabled = !model.busy) { Text("Retry AI") }
                        TextButton(onClick = { deleting = id }, enabled = !model.busy) { Text("Delete message") }
                    }
                    HorizontalDivider()
                }
            }
            if (!snapshot.data.isNull("nextCursor")) item { TextButton(onClick = { model.navigate("chat", "before=${snapshot.data.optInt("nextCursor")}") }, enabled = !model.busy) { Text("Older messages") } }
            if (model.query.isNotEmpty()) item { TextButton(onClick = { model.navigate("chat") }, enabled = !model.busy) { Text("Latest messages") } }
        }
        Column(Modifier.padding(16.dp)) {
            OutlinedTextField(text, { text = it }, label = { Text("Capture a thought") }, minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth(), enabled = !model.busy)
            Button(onClick = { model.act("send", mapOf("content" to text)) { text = "" } }, enabled = !model.busy && text.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text(if (model.busy) "Working…" else "Send") }
            Text("AI proposes changes. You decide what to accept.", style = MaterialTheme.typography.bodySmall)
        }
    }
    deleting?.let { id -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text("Delete this message?") }, text = { Text("Its suggestions will be removed. Accepted tasks are kept.") }, confirmButton = { TextButton(onClick = { model.act("delete", mapOf("id" to id.toString())) { deleting = null } }, enabled = !model.busy) { Text("Delete") } }, dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } }) }
}

@Composable fun CheckPlanSheet(model: AppModel, result: JSONObject) {
    ModalBottomSheet(onDismissRequest = { if (!model.busy) model.checkResult = null }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Plan check", style = MaterialTheme.typography.headlineSmall)
            if (result.optBoolean("offline")) Text(result.text("aiError", "AI is unavailable. Date checks are still shown."))
            if (model.error.isNotEmpty()) Text(model.error, color = MaterialTheme.colorScheme.error)
            val concerns = result.rows("concerns")
            if (concerns.isEmpty() && result.rows("dueTasks").isEmpty() && result.rows("startWarnings").isEmpty()) Text("No concerns found.")
            fun resolve(id: Int, choice: String) { model.act("concern", mapOf("taskId" to id.toString(), "choice" to choice)) { model.checkResult = null } }
            result.rows("dueTasks").forEach { task -> Text(task.text("title")); TextButton(onClick = { resolve(task.getInt("id"), "Add") }, enabled = !model.busy) { Text("Queue up") } }
            result.rows("startWarnings").forEach { task ->
                Text(task.text("title")); Text("Due ${task.text("dueAt")} · Start by ${task.text("startBy", "now")}", style = MaterialTheme.typography.bodySmall)
                if (task.optBoolean("planned")) Text("Already in Now") else TextButton(onClick = { resolve(task.getInt("taskId"), "Start") }, enabled = !model.busy) { Text("Queue up") }
            }
            concerns.forEach { concern ->
                Text(concern.text("observation"), style = MaterialTheme.typography.titleMedium); Text(concern.text("reason"))
                Row { concern.optJSONArray("choices")?.let { choices -> (0 until choices.length()).forEach { i -> val choice = choices.getString(i); TextButton(onClick = { resolve(concern.getInt("taskId"), choice) }, enabled = !model.busy) { Text(choice) } } } }
            }
            TextButton(onClick = { model.checkResult = null }, enabled = !model.busy) { Text("Dismiss plan check") }
        }
    }
}
